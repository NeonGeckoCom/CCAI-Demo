import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from app.llm.improved_brainforge_client import ImprovedBrainForgeClient

FAKE_URL = "https://fake.brainforge.example.com"
FAKE_MODEL = "BrainForge/neonai@2026.01.26"


def _make_chat_response(content="Hello from BrainForge"):
    """Build a mock httpx.Response for a successful chat completion."""
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {
        "choices": [{"message": {"content": f"  {content}  "}}],
    }
    return resp


def _make_models_response(model_name="BrainForge/neonai", version="2026.01.26"):
    """Build a mock httpx.Response for get_models."""
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {
        "models": [{"name": model_name, "version": version}],
    }
    return resp


def _make_client(auth_manager=None, model_id=FAKE_MODEL):
    """Create an ImprovedBrainForgeClient with a mocked auth manager."""
    mock_auth = auth_manager or AsyncMock()
    mock_auth.get_token = AsyncMock(return_value="fake-token")
    return ImprovedBrainForgeClient(
        api_url=FAKE_URL,
        model_id=model_id,
        auth_manager=mock_auth,
    )


def _setup_http_mock(MockHttpClient, response):
    """Wire up MockHttpClient to return the given response from post()."""
    mock_http = AsyncMock()
    mock_http.post.return_value = response
    MockHttpClient.return_value.__aenter__ = AsyncMock(return_value=mock_http)
    MockHttpClient.return_value.__aexit__ = AsyncMock(return_value=False)
    return mock_http


@patch("app.llm.improved_brainforge_client.httpx.AsyncClient")
@patch("app.llm.improved_brainforge_client.get_context_manager")
class TestImprovedBrainForgeClient(unittest.TestCase):

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------

    def test_constructor_stores_attributes(self, mock_ctx, MockHttpClient):
        client = ImprovedBrainForgeClient(
            api_url=FAKE_URL, model_id=FAKE_MODEL, auth_manager=AsyncMock(),
        )
        self.assertEqual(client.api_url, FAKE_URL)
        self.assertEqual(client.model_id, FAKE_MODEL)

    def test_constructor_strips_trailing_slash(self, mock_ctx, MockHttpClient):
        client = ImprovedBrainForgeClient(
            api_url=f"{FAKE_URL}/", model_id=FAKE_MODEL, auth_manager=AsyncMock(),
        )
        self.assertEqual(client.api_url, FAKE_URL)

    def test_constructor_accepts_auth_manager(self, mock_ctx, MockHttpClient):
        mock_auth = AsyncMock()
        client = ImprovedBrainForgeClient(
            api_url=FAKE_URL, auth_manager=mock_auth,
        )
        self.assertIs(client._auth, mock_auth)

    def test_constructor_creates_auth_from_credentials(self, mock_ctx, MockHttpClient):
        client = ImprovedBrainForgeClient(
            api_url=FAKE_URL, username="user", password="pass",
        )
        self.assertIsNotNone(client._auth)
        self.assertEqual(client._auth._username, "user")

    # ------------------------------------------------------------------
    # generate — happy path
    # ------------------------------------------------------------------

    def test_generate_returns_cleaned_response(self, mock_ctx, MockHttpClient):
        client = _make_client()
        _setup_http_mock(MockHttpClient, _make_chat_response("Here is my response."))

        result = asyncio.run(client.generate(
            system_prompt="You are helpful.",
            context=[{"role": "user", "content": "Hello"}],
            temperature=0.7,
            max_tokens=100,
        ))
        self.assertEqual(result, "Here is my response.")

    def test_generate_sends_correct_payload(self, mock_ctx, MockHttpClient):
        client = _make_client()
        mock_http = _setup_http_mock(MockHttpClient, _make_chat_response())

        asyncio.run(client.generate(
            system_prompt="Test",
            context=[{"role": "user", "content": "Hi"}],
            temperature=0.5,
            max_tokens=50,
        ))

        call_args = mock_http.post.call_args
        self.assertIn("/brainforge/openai/chat/completions", call_args[0][0])
        payload = call_args[1]["json"]
        self.assertEqual(payload["model"], FAKE_MODEL)
        self.assertEqual(payload["temperature"], 0.5)
        self.assertEqual(payload["max_tokens"], 100)  # 50 * 2 (JSON overhead scaling)

    def test_generate_auto_discovers_model_when_none(self, mock_ctx, MockHttpClient):
        client = _make_client(model_id=None)

        mock_http = AsyncMock()
        mock_http.post.side_effect = [
            _make_models_response(),
            _make_chat_response(),
        ]
        MockHttpClient.return_value.__aenter__ = AsyncMock(return_value=mock_http)
        MockHttpClient.return_value.__aexit__ = AsyncMock(return_value=False)

        asyncio.run(client.generate(
            system_prompt="Test",
            context=[{"role": "user", "content": "Hi"}],
            temperature=0.5,
            max_tokens=50,
        ))

        self.assertEqual(client.model_id, "BrainForge/neonai@2026.01.26")

    # ------------------------------------------------------------------
    # generate — error handling
    # ------------------------------------------------------------------

    def test_generate_handles_non_200(self, mock_ctx, MockHttpClient):
        client = _make_client()

        mock_resp = MagicMock()
        mock_resp.status_code = 422
        mock_resp.text = '{"detail":"validation error"}'
        _setup_http_mock(MockHttpClient, mock_resp)

        result = asyncio.run(client.generate(
            system_prompt="Test",
            context=[{"role": "user", "content": "Hi"}],
            temperature=0.5,
            max_tokens=50,
        ))
        self.assertIn("error", result.lower())

    def test_generate_clears_model_on_500_model_not_found(self, mock_ctx, MockHttpClient):
        client = _make_client()

        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_resp.text = '{"detail":"model not found"}'
        _setup_http_mock(MockHttpClient, mock_resp)

        asyncio.run(client.generate(
            system_prompt="Test",
            context=[{"role": "user", "content": "Hi"}],
            temperature=0.5,
            max_tokens=50,
        ))
        self.assertIsNone(client.model_id)

    def test_generate_handles_connect_error(self, mock_ctx, MockHttpClient):
        client = _make_client()

        mock_http = AsyncMock()
        mock_http.post.side_effect = httpx.ConnectError("Connection refused")
        MockHttpClient.return_value.__aenter__ = AsyncMock(return_value=mock_http)
        MockHttpClient.return_value.__aexit__ = AsyncMock(return_value=False)

        result = asyncio.run(client.generate(
            system_prompt="Test",
            context=[{"role": "user", "content": "Hi"}],
            temperature=0.5,
            max_tokens=50,
        ))
        self.assertIn("unable to connect", result.lower())

    def test_generate_handles_timeout(self, mock_ctx, MockHttpClient):
        client = _make_client()

        mock_http = AsyncMock()
        mock_http.post.side_effect = httpx.TimeoutException("timed out")
        MockHttpClient.return_value.__aenter__ = AsyncMock(return_value=mock_http)
        MockHttpClient.return_value.__aexit__ = AsyncMock(return_value=False)

        result = asyncio.run(client.generate(
            system_prompt="Test",
            context=[{"role": "user", "content": "Hi"}],
            temperature=0.5,
            max_tokens=50,
        ))
        self.assertIn("too long", result.lower())

    def test_generate_handles_auth_failure(self, mock_ctx, MockHttpClient):
        mock_auth = AsyncMock()
        mock_auth.get_token.side_effect = RuntimeError("auth failed")
        client = ImprovedBrainForgeClient(
            api_url=FAKE_URL, model_id=FAKE_MODEL, auth_manager=mock_auth,
        )

        result = asyncio.run(client.generate(
            system_prompt="Test",
            context=[{"role": "user", "content": "Hi"}],
            temperature=0.5,
            max_tokens=50,
        ))
        self.assertIn("authenticate", result.lower())

    # ------------------------------------------------------------------
    # health_check
    # ------------------------------------------------------------------

    def test_health_check_true_on_200(self, mock_ctx, MockHttpClient):
        client = _make_client()

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        _setup_http_mock(MockHttpClient, mock_resp)

        result = asyncio.run(client.health_check())
        self.assertTrue(result)

    def test_health_check_false_on_exception(self, mock_ctx, MockHttpClient):
        client = _make_client()

        mock_http = AsyncMock()
        mock_http.post.side_effect = Exception("boom")
        MockHttpClient.return_value.__aenter__ = AsyncMock(return_value=mock_http)
        MockHttpClient.return_value.__aexit__ = AsyncMock(return_value=False)

        result = asyncio.run(client.health_check())
        self.assertFalse(result)
