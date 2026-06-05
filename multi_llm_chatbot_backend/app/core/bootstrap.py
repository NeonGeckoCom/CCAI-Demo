# app/core/bootstrap.py
import asyncio
import logging

from app.config import get_settings
from app.llm.improved_gemini_client import ImprovedGeminiClient
from app.llm.improved_ollama_client import ImprovedOllamaClient
from app.llm.improved_vllm_client import ImprovedVllmClient
from app.core.improved_orchestrator import ImprovedChatOrchestrator
from app.models.default_personas import get_default_personas
from app.models.user import LLM_BACKENDS
from app.llm.llm_client import LLMClient

logger = logging.getLogger(__name__)

settings = get_settings()

_client_cache = {}


def create_llm_client(backend: str = None):
    """Create an LLM client for the given backend name."""
    if backend is None:
        backend = settings.llm.default_backend
    if backend not in LLM_BACKENDS:
        raise ValueError(
            f"Unknown backend {backend!r}. Must be one of {LLM_BACKENDS}"
        )
    if backend == "gemini":
        return ImprovedGeminiClient(model_name=settings.llm.gemini.model)
    elif backend == "vllm":
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


def get_llm_client(backend: str) -> LLMClient:
    """Return a cached LLM client for *backend*, creating it on first access."""
    if backend not in _client_cache:
        _client_cache[backend] = create_llm_client(backend)
    return _client_cache[backend]


def _is_backend_enabled(backend: str) -> bool:
    """Check whether *backend* is enabled in the admin config."""
    backend_config = getattr(settings.llm, backend, None)
    return getattr(backend_config, "enabled", True)


def get_available_backends() -> list:
    """Return backends that are enabled and properly configured (sync, used at startup)."""
    available = []
    for backend in LLM_BACKENDS:
        if not _is_backend_enabled(backend):
            continue
        try:
            get_llm_client(backend)
            available.append(backend)
        except Exception:
            pass
    return available


async def refresh_available_backends():
    """Re-check which backends are enabled, configured, and reachable."""
    available = []
    for backend in LLM_BACKENDS:
        if not _is_backend_enabled(backend):
            continue
        try:
            client = get_llm_client(backend)
            if await client.health_check():
                available.append(backend)
        except Exception:
            pass
    AVAILABLE_BACKENDS[:] = available


async def _backend_health_loop():
    """Background task that periodically refreshes AVAILABLE_BACKENDS."""
    interval = settings.llm.health_check_interval_seconds
    while True:
        await refresh_available_backends()
        await asyncio.sleep(interval)


# Resolve the default backend: prefer the configured default, fall back to the first available.
AVAILABLE_BACKENDS = get_available_backends()
if settings.llm.default_backend in AVAILABLE_BACKENDS:
    DEFAULT_BACKEND = settings.llm.default_backend
elif AVAILABLE_BACKENDS:
    DEFAULT_BACKEND = AVAILABLE_BACKENDS[0]
    logger.warning(
        "Configured default_backend %r is not available; falling back to %r",
        settings.llm.default_backend, DEFAULT_BACKEND,
    )
else:
    raise RuntimeError(
        "No LLM backends are available. Check your config.yaml — "
        "at least one backend must be enabled and properly configured."
    )
llm = create_llm_client(DEFAULT_BACKEND)
_client_cache[DEFAULT_BACKEND] = llm
chat_orchestrator = ImprovedChatOrchestrator(llm_client=llm)

DEFAULT_PERSONAS = get_default_personas(llm)
for persona in DEFAULT_PERSONAS:
    chat_orchestrator.register_persona(persona)
