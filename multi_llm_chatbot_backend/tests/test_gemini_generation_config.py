import unittest
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

if "httpx" not in sys.modules:
    fake_httpx = types.ModuleType("httpx")
    fake_httpx.AsyncClient = object
    fake_httpx.HTTPStatusError = Exception
    fake_httpx.TimeoutException = TimeoutError
    sys.modules["httpx"] = fake_httpx

if "openai" not in sys.modules:
    fake_openai = types.ModuleType("openai")
    fake_openai.AsyncOpenAI = MagicMock
    fake_openai.APIConnectionError = Exception
    fake_openai.APIStatusError = Exception
    sys.modules["openai"] = fake_openai

fake_config = types.ModuleType("app.config")
fake_config.get_settings = MagicMock()
fake_context_manager_module = types.ModuleType("app.core.context_manager")
fake_context_manager_module.get_context_manager = MagicMock()
original_config = sys.modules.get("app.config")
original_context_manager = sys.modules.get("app.core.context_manager")
sys.modules["app.config"] = fake_config
sys.modules["app.core.context_manager"] = fake_context_manager_module
from app.llm.clients.improved_gemini_client import ImprovedGeminiClient
if original_config is None:
    del sys.modules["app.config"]
else:
    sys.modules["app.config"] = original_config
if original_context_manager is None:
    del sys.modules["app.core.context_manager"]
else:
    sys.modules["app.core.context_manager"] = original_context_manager


class FakeGeminiResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "candidates": [
                {
                    "finishReason": "STOP",
                    "content": {
                        "parts": [{"text": "Done"}],
                    },
                }
            ]
        }


class FakeAsyncClient:
    last_payload = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, *, json, headers):
        FakeAsyncClient.last_payload = json
        return FakeGeminiResponse()


class FakeGeminiStreamResponse:
    def raise_for_status(self):
        return None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def aiter_lines(self):
        lines = [
            'data: {"candidates": [{"content": {"parts": [{"text": "Planning", "thought": true}]}}]}',
            "",
            'data: {"candidates": [{"content": {"parts": [{"text": "Hello "}]}}]}',
            'data: {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "world"}]}}]}',
        ]
        for line in lines:
            yield line


class FakeStreamAsyncClient:
    last_payload = None
    last_url = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def stream(self, method, url, *, json, headers):
        FakeStreamAsyncClient.last_payload = json
        FakeStreamAsyncClient.last_url = url
        return FakeGeminiStreamResponse()


def _settings(model_name):
    return SimpleNamespace(
        llm=SimpleNamespace(
            gemini=SimpleNamespace(api_key="fake-key", model=model_name),
        )
    )


def _context_manager():
    manager = MagicMock()
    manager.prepare_context_for_llm.return_value = SimpleNamespace(
        messages=[{"role": "user", "parts": [{"text": "Hello"}]}],
        total_tokens=12,
        truncated=False,
    )
    return manager


class GeminiGenerationConfigTests(unittest.IsolatedAsyncioTestCase):
    async def test_gemini_3_disables_thinking_for_normal_text_generation(self):
        with patch(
            "app.llm.clients.improved_gemini_client.get_settings",
            return_value=_settings("gemini-3-flash-preview"),
        ), patch(
            "app.llm.clients.improved_gemini_client.get_context_manager",
            return_value=_context_manager(),
        ), patch("app.llm.clients.improved_gemini_client.httpx.AsyncClient", FakeAsyncClient):
            client = ImprovedGeminiClient()
            result = await client.generate(
                system_prompt="System",
                context=[{"role": "user", "content": "Hello"}],
                temperature=0.2,
                max_tokens=550,
            )

        self.assertEqual(result, "Done")
        generation_config = FakeAsyncClient.last_payload["generationConfig"]
        self.assertEqual(generation_config["thinkingConfig"], {"thinkingBudget": 0})
        self.assertEqual(generation_config["maxOutputTokens"], 550)

    async def test_older_gemini_model_does_not_send_thinking_config(self):
        with patch(
            "app.llm.clients.improved_gemini_client.get_settings",
            return_value=_settings("gemini-2.0-flash"),
        ), patch(
            "app.llm.clients.improved_gemini_client.get_context_manager",
            return_value=_context_manager(),
        ), patch("app.llm.clients.improved_gemini_client.httpx.AsyncClient", FakeAsyncClient):
            client = ImprovedGeminiClient()
            await client.generate(
                system_prompt="System",
                context=[{"role": "user", "content": "Hello"}],
                temperature=0.2,
                max_tokens=550,
            )

        generation_config = FakeAsyncClient.last_payload["generationConfig"]
        self.assertNotIn("thinkingConfig", generation_config)

    async def test_stream_generation_omits_output_cap_and_streams_thoughts(self):
        with patch(
            "app.llm.clients.improved_gemini_client.get_settings",
            return_value=_settings("gemini-3-flash-preview"),
        ), patch(
            "app.llm.clients.improved_gemini_client.get_context_manager",
            return_value=_context_manager(),
        ), patch("app.llm.clients.improved_gemini_client.httpx.AsyncClient", FakeStreamAsyncClient):
            client = ImprovedGeminiClient()
            chunks = []
            async for chunk in client.stream_generate(
                system_prompt="System",
                context=[{"role": "user", "content": "Hello"}],
                temperature=0.2,
                max_tokens=None,
                include_thoughts=True,
            ):
                chunks.append((chunk.kind, chunk.text))

        self.assertEqual(
            chunks,
            [
                ("thought", "Planning"),
                ("text", "Hello "),
                ("text", "world"),
            ],
        )
        generation_config = FakeStreamAsyncClient.last_payload["generationConfig"]
        self.assertNotIn("maxOutputTokens", generation_config)
        self.assertEqual(generation_config["thinkingConfig"], {"includeThoughts": True})
        self.assertIn(":streamGenerateContent?alt=sse", FakeStreamAsyncClient.last_url)


if __name__ == "__main__":
    unittest.main()
