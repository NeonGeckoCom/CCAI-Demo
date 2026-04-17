import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from openai import APIConnectionError, APIStatusError

from app.llm.improved_vllm_client import ImprovedVllmClient


FAKE_URL = "https://fake.example.com/vllm0"
FAKE_KEY = "test-key"


def _make_completion_mock(content="Response"):
    """Build a mock that looks like an OpenAI ChatCompletion."""
    mock_message = MagicMock()
    mock_message.content = content
    mock_choice = MagicMock()
    mock_choice.message = mock_message
    return MagicMock(choices=[mock_choice])


@patch("app.llm.improved_vllm_client.get_context_manager")
@patch("app.llm.improved_vllm_client.AsyncOpenAI")
class TestImprovedVllmClient(unittest.TestCase):

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------

    def test_constructor_stores_attributes(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        self.assertEqual(client.api_url, FAKE_URL)
        self.assertEqual(client.api_key, FAKE_KEY)
        self.assertEqual(client.model_name, "test-model")

    def test_constructor_defaults_model_to_none(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(api_url=FAKE_URL, api_key=FAKE_KEY)
        self.assertIsNone(client.model_name)

    # ------------------------------------------------------------------
    # Model discovery
    # ------------------------------------------------------------------

    def test_refresh_model_discovers_model(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(api_url=FAKE_URL, api_key=FAKE_KEY)

        mock_model = MagicMock()
        mock_model.id = "discovered-model"
        client.client.models.list = AsyncMock(
            return_value=MagicMock(data=[mock_model])
        )

        asyncio.run(client.refresh_model())
        self.assertEqual(client.model_name, "discovered-model")

    # ------------------------------------------------------------------
    # generate – happy path
    # ------------------------------------------------------------------

    def test_generate_returns_cleaned_response(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        client.client.chat.completions.create = AsyncMock(
            return_value=_make_completion_mock("  Here is my response.  ")
        )

        result = asyncio.run(client.generate(
            system_prompt="You are helpful.",
            context=[{"role": "user", "content": "Hello"}],
            temperature=0.7,
            max_tokens=100,
        ))
        self.assertEqual(result, "Here is my response.")

    def test_generate_auto_discovers_model_when_none(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name=None,
        )

        mock_model = MagicMock()
        mock_model.id = "auto-discovered"
        client.client.models.list = AsyncMock(
            return_value=MagicMock(data=[mock_model])
        )
        client.client.chat.completions.create = AsyncMock(
            return_value=_make_completion_mock()
        )

        asyncio.run(client.generate(
            system_prompt="Test",
            context=[{"role": "user", "content": "Hi"}],
            temperature=0.5,
            max_tokens=50,
        ))

        client.client.models.list.assert_called_once()
        self.assertEqual(client.model_name, "auto-discovered")

    # ------------------------------------------------------------------
    # generate – error handling
    # ------------------------------------------------------------------

    def test_generate_handles_connection_error(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        client.client.chat.completions.create = AsyncMock(
            side_effect=APIConnectionError(request=MagicMock())
        )

        result = asyncio.run(client.generate(
            system_prompt="Test",
            context=[{"role": "user", "content": "Hi"}],
            temperature=0.5,
            max_tokens=50,
        ))
        self.assertIn("unable to connect", result.lower())

    def test_generate_handles_status_error(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        mock_response = MagicMock()
        mock_response.status_code = 500
        client.client.chat.completions.create = AsyncMock(
            side_effect=APIStatusError(
                message="Server error", response=mock_response, body=None,
            )
        )

        result = asyncio.run(client.generate(
            system_prompt="Test",
            context=[{"role": "user", "content": "Hi"}],
            temperature=0.5,
            max_tokens=50,
        ))
        self.assertIn("error", result.lower())

    def test_generate_clears_model_on_404(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="stale-model",
        )
        mock_response = MagicMock()
        mock_response.status_code = 404
        client.client.chat.completions.create = AsyncMock(
            side_effect=APIStatusError(
                message="Model not found", response=mock_response, body=None,
            )
        )

        asyncio.run(client.generate(
            system_prompt="Test",
            context=[{"role": "user", "content": "Hi"}],
            temperature=0.5,
            max_tokens=50,
        ))
        self.assertIsNone(client.model_name)

    # ------------------------------------------------------------------
    # generate – response_format for JSON
    # ------------------------------------------------------------------

    def test_generate_passes_response_format_for_json(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        client.client.chat.completions.create = AsyncMock(
            return_value=_make_completion_mock('{"key": "value"}')
        )

        asyncio.run(client.generate(
            system_prompt="Return JSON",
            context=[{"role": "user", "content": "Hi"}],
            temperature=0.3,
            max_tokens=100,
            response_mime_type="application/json",
        ))

        call_kwargs = client.client.chat.completions.create.call_args.kwargs
        self.assertEqual(call_kwargs["response_format"], {"type": "json_object"})

    def test_generate_omits_response_format_when_no_mime_type(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        client.client.chat.completions.create = AsyncMock(
            return_value=_make_completion_mock("plain text response")
        )

        asyncio.run(client.generate(
            system_prompt="You are helpful.",
            context=[{"role": "user", "content": "Hello"}],
            temperature=0.7,
            max_tokens=100,
        ))

        call_kwargs = client.client.chat.completions.create.call_args.kwargs
        self.assertNotIn("response_format", call_kwargs)

    # ------------------------------------------------------------------
    # _clean_response
    # ------------------------------------------------------------------

    def test_clean_response_normalizes_whitespace(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        dirty = "Line one.\r\n\r\n\r\n\r\nLine two.  "
        cleaned = client._clean_response(dirty)
        self.assertNotIn("\r", cleaned)
        self.assertNotIn("\n\n\n", cleaned)
        self.assertEqual(cleaned, "Line one.\n\nLine two.")
