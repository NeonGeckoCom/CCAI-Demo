import asyncio
import time
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.llm.brainforge_auth import BrainForgeAuthManager, TOKEN_EXPIRY_BUFFER

FAKE_URL = "https://fake.brainforge.example.com"
FAKE_USER = "testuser"
FAKE_PASS = "testpass"


def _make_login_response():
    """Build a mock httpx.Response for a successful login."""
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {
        "access_token": "access-abc",
        "refresh_token": "refresh-xyz",
        "expiration": time.time() + 3600,
    }
    return resp


def _make_refresh_response():
    """Build a mock httpx.Response for a successful token refresh."""
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {
        "access_token": "access-refreshed",
        "refresh_token": "refresh-new",
        "expiration": time.time() + 3600,
    }
    return resp


def _setup_http_mock(MockAsyncClient, response):
    """Wire up MockAsyncClient to return the given response from post()."""
    mock_client = AsyncMock()
    mock_client.post.return_value = response
    MockAsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
    MockAsyncClient.return_value.__aexit__ = AsyncMock(return_value=False)
    return mock_client


@patch("app.llm.brainforge_auth.httpx.AsyncClient")
class TestBrainForgeAuthManager(unittest.TestCase):

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------

    def test_constructor_stores_attributes(self, MockAsyncClient):
        auth = BrainForgeAuthManager(FAKE_URL, FAKE_USER, FAKE_PASS)
        self.assertEqual(auth._api_url, FAKE_URL)
        self.assertEqual(auth._username, FAKE_USER)
        self.assertEqual(auth._password, FAKE_PASS)
        self.assertIsNone(auth._access_token)
        self.assertIsNone(auth._refresh_token)

    def test_constructor_strips_trailing_slash(self, MockAsyncClient):
        auth = BrainForgeAuthManager(f"{FAKE_URL}/", FAKE_USER, FAKE_PASS)
        self.assertEqual(auth._api_url, FAKE_URL)

    # ------------------------------------------------------------------
    # Login
    # ------------------------------------------------------------------

    def test_login_sends_correct_payload(self, MockAsyncClient):
        auth = BrainForgeAuthManager(FAKE_URL, FAKE_USER, FAKE_PASS)
        mock_client = _setup_http_mock(MockAsyncClient, _make_login_response())

        asyncio.run(auth._login())

        call_args = mock_client.post.call_args
        self.assertEqual(call_args[0][0], f"{FAKE_URL}/auth/login")
        payload = call_args[1]["json"]
        self.assertEqual(payload["username"], FAKE_USER)
        self.assertEqual(payload["password"], FAKE_PASS)

    def test_login_stores_tokens_on_success(self, MockAsyncClient):
        auth = BrainForgeAuthManager(FAKE_URL, FAKE_USER, FAKE_PASS)
        _setup_http_mock(MockAsyncClient, _make_login_response())

        asyncio.run(auth._login())

        self.assertEqual(auth._access_token, "access-abc")
        self.assertEqual(auth._refresh_token, "refresh-xyz")
        self.assertGreater(auth._expiration, time.time())

    def test_login_raises_on_non_200(self, MockAsyncClient):
        auth = BrainForgeAuthManager(FAKE_URL, FAKE_USER, FAKE_PASS)

        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_resp.text = '{"detail":"Invalid username or password"}'
        _setup_http_mock(MockAsyncClient, mock_resp)

        with self.assertRaises(RuntimeError):
            asyncio.run(auth._login())

    # ------------------------------------------------------------------
    # Token refresh
    # ------------------------------------------------------------------

    def test_refresh_updates_tokens_on_success(self, MockAsyncClient):
        auth = BrainForgeAuthManager(FAKE_URL, FAKE_USER, FAKE_PASS)
        auth._access_token = "old-access"
        auth._refresh_token = "old-refresh"
        _setup_http_mock(MockAsyncClient, _make_refresh_response())

        result = asyncio.run(auth._refresh())

        self.assertTrue(result)
        self.assertEqual(auth._access_token, "access-refreshed")
        self.assertEqual(auth._refresh_token, "refresh-new")

    def test_refresh_returns_false_on_failure(self, MockAsyncClient):
        auth = BrainForgeAuthManager(FAKE_URL, FAKE_USER, FAKE_PASS)
        auth._access_token = "old-access"
        auth._refresh_token = "old-refresh"

        mock_resp = MagicMock()
        mock_resp.status_code = 401
        _setup_http_mock(MockAsyncClient, mock_resp)

        result = asyncio.run(auth._refresh())
        self.assertFalse(result)

    # ------------------------------------------------------------------
    # get_token flow
    # ------------------------------------------------------------------

    def test_get_token_returns_cached_when_valid(self, MockAsyncClient):
        auth = BrainForgeAuthManager(FAKE_URL, FAKE_USER, FAKE_PASS)
        auth._access_token = "cached-token"
        auth._expiration = time.time() + 3600

        token = asyncio.run(auth.get_token())
        self.assertEqual(token, "cached-token")

    def test_get_token_refreshes_when_near_expiry(self, MockAsyncClient):
        auth = BrainForgeAuthManager(FAKE_URL, FAKE_USER, FAKE_PASS)
        auth._access_token = "expiring-token"
        auth._refresh_token = "has-refresh"
        auth._expiration = time.time() + (TOKEN_EXPIRY_BUFFER - 1)
        _setup_http_mock(MockAsyncClient, _make_refresh_response())

        token = asyncio.run(auth.get_token())
        self.assertEqual(token, "access-refreshed")

    def test_get_token_logins_when_no_tokens(self, MockAsyncClient):
        auth = BrainForgeAuthManager(FAKE_URL, FAKE_USER, FAKE_PASS)
        _setup_http_mock(MockAsyncClient, _make_login_response())

        token = asyncio.run(auth.get_token())
        self.assertEqual(token, "access-abc")

    # ------------------------------------------------------------------
    # Health check
    # ------------------------------------------------------------------

    def test_health_check_true_on_valid_token(self, MockAsyncClient):
        auth = BrainForgeAuthManager(FAKE_URL, FAKE_USER, FAKE_PASS)
        auth._access_token = "valid-token"
        auth._expiration = time.time() + 3600

        result = asyncio.run(auth.health_check())
        self.assertTrue(result)

    def test_health_check_false_on_exception(self, MockAsyncClient):
        auth = BrainForgeAuthManager(FAKE_URL, FAKE_USER, FAKE_PASS)

        mock_client = AsyncMock()
        mock_client.post.side_effect = Exception("connection refused")
        MockAsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockAsyncClient.return_value.__aexit__ = AsyncMock(return_value=False)

        result = asyncio.run(auth.health_check())
        self.assertFalse(result)
