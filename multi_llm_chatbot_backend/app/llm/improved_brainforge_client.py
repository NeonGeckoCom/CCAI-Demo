import logging
from typing import Any, Callable, Dict, List, Optional

import httpx

from app.llm.llm_client import LLMClient, ToolCallResult
from app.llm.brainforge_auth import BrainForgeAuthManager
from app.core.context_manager import get_context_manager

logger = logging.getLogger(__name__)


class ImprovedBrainForgeClient(LLMClient):
    """LLM client for BrainForge via its OpenAI-compatible endpoint.

    Uses bearer-token auth (managed by BrainForgeAuthManager) and sends
    requests to ``/brainforge/openai/chat/completions``.
    """

    def __init__(
        self,
        api_url: str,
        username: str,
        password: str,
        model_id: Optional[str] = None,
        auth_manager: Optional[BrainForgeAuthManager] = None,
    ):
        self.api_url = api_url.rstrip("/")
        self.model_id = model_id
        self._auth = auth_manager or BrainForgeAuthManager(api_url, username, password)
        self.context_manager = get_context_manager()

    async def refresh_model(self):
        """Discover the first available model from BrainForge."""
        token = await self._auth.get_token()
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{self.api_url}/brainforge/get_models",
                headers={"Authorization": f"Bearer {token}"},
            )

        if resp.status_code != 200:
            raise ValueError(f"BrainForge get_models failed: HTTP {resp.status_code}")

        models = resp.json().get("models", [])
        if not models:
            raise ValueError("No models available on BrainForge")

        self.model_id = f"{models[0]['name']}@{models[0]['version']}"
        logger.info("BrainForge auto-selected model: %s", self.model_id)

    async def generate(
        self,
        system_prompt: str,
        context: List[dict],
        temperature: float,
        max_tokens: int,
        response_mime_type: str = None,
    ) -> str:
        try:
            context_window = self.context_manager.prepare_context_for_llm(
                messages=context,
                system_prompt=system_prompt,
                llm_provider="brainforge",
            )

            logger.debug(
                "BrainForge context prepared: %d messages, ~%d tokens, truncated=%s",
                len(context_window.messages),
                context_window.total_tokens,
                context_window.truncated,
            )

            if not self.model_id:
                await self.refresh_model()

            token = await self._auth.get_token()

            payload = {
                "model": self.model_id,
                "messages": context_window.messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }

            async with httpx.AsyncClient(timeout=90) as client:
                resp = await client.post(
                    f"{self.api_url}/brainforge/openai/chat/completions",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )

            if resp.status_code != 200:
                logger.error(
                    "BrainForge API error: %s - %s",
                    resp.status_code,
                    resp.text[:200],
                )
                if resp.status_code == 500 and "model not found" in resp.text.lower():
                    logger.info("Model not found, will re-discover on next request")
                    self.model_id = None
                return "The AI service encountered an error. Please try again."

            data = resp.json()
            text = data["choices"][0]["message"]["content"].strip()
            return self._clean_response(text)

        except httpx.ConnectError:
            logger.error("Unable to connect to BrainForge at %s", self.api_url)
            return "I'm unable to connect to the BrainForge service. Please try again later."
        except httpx.TimeoutException:
            logger.error("BrainForge request timed out")
            return "The BrainForge service is taking too long to respond. Please try again."
        except RuntimeError as e:
            logger.error("BrainForge auth failure: %s", e)
            return "Unable to authenticate with BrainForge. Please check credentials."
        except Exception as e:
            logger.error("Unexpected error in BrainForge client: %s", e)
            return "I encountered an unexpected error. Please try again."

    async def health_check(self) -> bool:
        """Check if BrainForge is reachable and authenticated."""
        try:
            token = await self._auth.get_token()
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{self.api_url}/brainforge/get_models",
                    headers={"Authorization": f"Bearer {token}"},
                )
            return resp.status_code == 200
        except Exception:
            return False
