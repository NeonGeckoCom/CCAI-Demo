import asyncio
import logging
import time
import uuid

import httpx

logger = logging.getLogger(__name__)

TOKEN_EXPIRY_BUFFER = 60  # refresh this many seconds before actual expiry


class BrainForgeAuthManager:
    """Manages authentication tokens for the BrainForge (HANA) API.

    Handles login, caching, and automatic refresh so callers can simply
    await ``get_token()`` to obtain a valid bearer token.
    """

    def __init__(self, api_url: str, username: str, password: str):
        self._api_url = api_url.rstrip("/")
        self._username = username
        self._password = password
        self._client_id = f"ccai-backend-{uuid.uuid4().hex[:8]}"

        self._access_token: str | None = None
        self._refresh_token: str | None = None
        self._expiration: float = 0.0

        self._lock = asyncio.Lock()

    async def get_token(self) -> str:
        """Return a valid bearer token, refreshing or re-logging in as needed."""
        async with self._lock:
            if self._access_token and time.time() < self._expiration - TOKEN_EXPIRY_BUFFER:
                return self._access_token

            if self._refresh_token:
                refreshed = await self._refresh()
                if refreshed:
                    return self._access_token

            await self._login()
            return self._access_token

    async def health_check(self) -> bool:
        """Return True if we can successfully authenticate."""
        try:
            await self.get_token()
            return True
        except Exception:
            return False

    async def _login(self) -> None:
        """Authenticate with username/password and store tokens."""
        url = f"{self._api_url}/auth/login"
        payload = {
            "username": self._username,
            "password": self._password,
            "token_name": "ccai-backend",
            "client_id": self._client_id,
        }

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(url, json=payload)

        if resp.status_code != 200:
            logger.error(
                "BrainForge login failed: %s %s", resp.status_code, resp.text[:200]
            )
            raise RuntimeError(
                f"BrainForge authentication failed (HTTP {resp.status_code})"
            )

        data = resp.json()
        self._access_token = data["access_token"]
        self._refresh_token = data["refresh_token"]
        self._expiration = data["expiration"]
        logger.info("BrainForge login successful (user=%s)", self._username)

    async def _refresh(self) -> bool:
        """Attempt to refresh the access token. Returns False on failure."""
        url = f"{self._api_url}/auth/refresh"
        payload = {"access_token": self._access_token, "refresh_token": self._refresh_token}

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(url, json=payload)

            if resp.status_code != 200:
                logger.warning(
                    "BrainForge token refresh failed (%s), will re-login",
                    resp.status_code,
                )
                return False

            data = resp.json()
            self._access_token = data["access_token"]
            self._refresh_token = data["refresh_token"]
            self._expiration = data["expiration"]
            logger.debug("BrainForge token refreshed successfully")
            return True

        except Exception as exc:
            logger.warning("BrainForge token refresh error: %s, will re-login", exc)
            return False
