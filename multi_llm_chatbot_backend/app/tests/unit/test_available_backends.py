import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.core.bootstrap import (
    get_available_backends,
    refresh_available_backends,
    AVAILABLE_BACKENDS,
    LLM_BACKENDS,
)


class TestGetAvailableBackends(unittest.TestCase):
    """Sync config-only check used at startup."""

    @patch("app.core.bootstrap.get_llm_client")
    def test_all_configured(self, mock_get_client):
        mock_get_client.return_value = MagicMock()
        result = get_available_backends()
        self.assertEqual(result, ["gemini", "ollama", "vllm"])

    @patch("app.core.bootstrap.get_llm_client")
    def test_vllm_not_configured(self, mock_get_client):
        def side_effect(backend):
            if backend == "vllm":
                raise ValueError("No vLLM endpoint configured.")
            return MagicMock()
        mock_get_client.side_effect = side_effect
        result = get_available_backends()
        self.assertEqual(result, ["gemini", "ollama"])

    @patch("app.core.bootstrap.get_llm_client")
    def test_none_configured(self, mock_get_client):
        mock_get_client.side_effect = ValueError("not configured")
        result = get_available_backends()
        self.assertEqual(result, [])


class TestRefreshAvailableBackends(unittest.TestCase):
    """Async health-check refresh."""

    @patch("app.core.bootstrap.get_llm_client")
    def test_all_healthy(self, mock_get_client):
        mock_client = MagicMock()
        mock_client.health_check = AsyncMock(return_value=True)
        mock_get_client.return_value = mock_client

        asyncio.run(refresh_available_backends())
        self.assertEqual(list(AVAILABLE_BACKENDS), ["gemini", "ollama", "vllm"])

    @patch("app.core.bootstrap.get_llm_client")
    def test_vllm_unhealthy(self, mock_get_client):
        def side_effect(backend):
            client = MagicMock()
            client.health_check = AsyncMock(return_value=(backend != "vllm"))
            return client
        mock_get_client.side_effect = side_effect

        asyncio.run(refresh_available_backends())
        self.assertEqual(list(AVAILABLE_BACKENDS), ["gemini", "ollama"])

    @patch("app.core.bootstrap.get_llm_client")
    def test_health_check_exception(self, mock_get_client):
        def side_effect(backend):
            client = MagicMock()
            if backend == "ollama":
                client.health_check = AsyncMock(side_effect=Exception("timeout"))
            else:
                client.health_check = AsyncMock(return_value=True)
            return client
        mock_get_client.side_effect = side_effect

        asyncio.run(refresh_available_backends())
        self.assertEqual(list(AVAILABLE_BACKENDS), ["gemini", "vllm"])

    @patch("app.core.bootstrap.get_llm_client")
    def test_unconfigured_backend_excluded(self, mock_get_client):
        def side_effect(backend):
            if backend == "vllm":
                raise ValueError("No vLLM endpoint configured.")
            client = MagicMock()
            client.health_check = AsyncMock(return_value=True)
            return client
        mock_get_client.side_effect = side_effect

        asyncio.run(refresh_available_backends())
        self.assertEqual(list(AVAILABLE_BACKENDS), ["gemini", "ollama"])


if __name__ == "__main__":
    unittest.main()
