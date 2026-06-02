"""Central LLM provider routing and client management.

Owns the single source of truth for which provider is active and the
canonical ``create_llm_client`` factory. Both ``app.core.bootstrap`` (at
startup) and the ``provider`` route (on switch) build clients through here,
so the two no longer carry divergent copies of this logic.
"""

import logging

from app.config import get_settings
from app.llm.clients.improved_gemini_client import ImprovedGeminiClient
from app.llm.clients.improved_ollama_client import ImprovedOllamaClient
from app.llm.clients.improved_vllm_client import ImprovedVllmClient
from app.llm.clients.llm_client import LLMClient

logger = logging.getLogger(__name__)

available_providers = ["ollama", "gemini", "vllm"]

_current_provider = "gemini"


def get_current_provider() -> str:
    """Return the provider that new clients are currently built for."""
    return _current_provider


def set_current_provider(provider: str) -> None:
    """Set the active provider used as the default for ``create_llm_client``."""
    global _current_provider
    _current_provider = provider


def create_llm_client(provider: str = None) -> LLMClient:
    """Build an LLM client for *provider* (defaults to the active provider).

    Provider settings are read from ``config.yaml`` so startup and runtime
    provider switches behave identically.
    """
    if provider is None:
        provider = _current_provider

    settings = get_settings()

    if provider == "gemini":
        return ImprovedGeminiClient(model_name=settings.llm.gemini.model)
    elif provider == "vllm":
        if not settings.llm.vllm.api_url:
            raise ValueError("No vLLM endpoint configured. Set llm.vllm.api_url in your config.")
        return ImprovedVllmClient(
            api_url=settings.llm.vllm.api_url,
            api_key=settings.llm.vllm.api_key,
        )
    else:
        return ImprovedOllamaClient(
            model_name=settings.llm.ollama.model,
            base_url=settings.llm.ollama.base_url,
        )
