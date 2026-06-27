"""Construct and monitor the configured LLM backends."""

import asyncio
import logging

from app.config import get_settings
from app.llm.clients import provider_manager
from app.llm.clients.llm_client import LLMClient
from app.llm.improved_orchestrator import ImprovedChatOrchestrator
from app.models.default_personas import get_default_personas
from app.models.user import LLM_BACKENDS

logger = logging.getLogger(__name__)
settings = get_settings()
_client_cache = {}


def create_llm_client(backend: str = None) -> LLMClient:
    """Create a client for a configured backend through the shared factory."""
    backend = backend or settings.llm.default_backend or "gemini"
    if backend not in LLM_BACKENDS:
        raise ValueError(f"Unknown backend {backend!r}. Must be one of {LLM_BACKENDS}")
    return provider_manager.create_llm_client(backend)


def get_llm_client(backend: str) -> LLMClient:
    """Return a cached client for *backend*, creating it on first access."""
    if backend not in _client_cache:
        _client_cache[backend] = create_llm_client(backend)
    return _client_cache[backend]


def _is_backend_enabled(backend: str) -> bool:
    backend_config = getattr(settings.llm, backend, None)
    return bool(getattr(backend_config, "enabled", True))


def get_available_backends() -> list:
    """Return enabled backends whose clients can be constructed."""
    available = []
    for backend in LLM_BACKENDS:
        if not _is_backend_enabled(backend):
            continue
        try:
            get_llm_client(backend)
            available.append(backend)
        except Exception as exc:
            logger.warning("Backend %s is unavailable: %s", backend, exc)
    return available


async def refresh_available_backends() -> None:
    """Refresh the in-place list of enabled, healthy backends."""
    available = []
    for backend in LLM_BACKENDS:
        if not _is_backend_enabled(backend):
            continue
        try:
            if await get_llm_client(backend).health_check():
                available.append(backend)
        except Exception as exc:
            logger.warning("Backend health check failed for %s: %s", backend, exc)
    AVAILABLE_BACKENDS[:] = available


async def _backend_health_loop() -> None:
    while True:
        await refresh_available_backends()
        await asyncio.sleep(settings.llm.health_check_interval_seconds)


AVAILABLE_BACKENDS = get_available_backends()
configured_default = settings.llm.default_backend or "gemini"
if configured_default in AVAILABLE_BACKENDS:
    DEFAULT_BACKEND = configured_default
elif AVAILABLE_BACKENDS:
    DEFAULT_BACKEND = AVAILABLE_BACKENDS[0]
    logger.warning(
        "Configured default backend %r is unavailable; using %r",
        configured_default,
        DEFAULT_BACKEND,
    )
else:
    raise RuntimeError("No enabled LLM backends could be configured")

llm = get_llm_client(DEFAULT_BACKEND)
chat_orchestrator = ImprovedChatOrchestrator(llm_client=llm)

for persona in get_default_personas(llm):
    chat_orchestrator.register_persona(persona)
