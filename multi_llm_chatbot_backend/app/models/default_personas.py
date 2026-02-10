"""
Persona registry — now driven by ``config.yaml``.

The heavy persona definitions have moved into ``config.yaml`` (under the
``personas`` key).  This module reads them via :func:`app.config.get_settings`
and exposes the same public API the rest of the codebase already relies on.
"""

from __future__ import annotations

from typing import List, Optional

from app.config import get_settings
from app.models.persona import Persona


def _build_personas_dict() -> dict:
    """Build the ``{id: {name, system_prompt, temperature}}`` registry from
    the YAML configuration."""
    cfg = get_settings()
    base_prompt = cfg.personas.base_prompt.strip()
    registry: dict = {}
    for p in cfg.personas.items:
        # Combine the persona-specific prompt with the shared base prompt
        full_prompt = p.persona_prompt.strip()
        if base_prompt:
            full_prompt = f"{full_prompt}\n\n{base_prompt}"
        registry[p.id] = {
            "name": p.name,
            "system_prompt": full_prompt,
            "default_temperature": p.temperature,
        }
    return registry


# Lazy singleton — built once on first access
_DEFAULT_PERSONAS: Optional[dict] = None


def _get_registry() -> dict:
    global _DEFAULT_PERSONAS
    if _DEFAULT_PERSONAS is None:
        _DEFAULT_PERSONAS = _build_personas_dict()
    return _DEFAULT_PERSONAS


# ------------------------------------------------------------------
# Public API — unchanged signatures so existing callers keep working
# ------------------------------------------------------------------

def get_default_personas(llm) -> List[Persona]:
    """Return a list of :class:`Persona` objects wired to *llm*."""
    return [
        Persona(
            id=pid,
            name=data["name"],
            system_prompt=data["system_prompt"],
            llm=llm,
            temperature=data.get("default_temperature", 5),
        )
        for pid, data in _get_registry().items()
    ]


def get_default_persona_prompt(persona_id: str) -> Optional[str]:
    data = _get_registry().get(persona_id)
    return data["system_prompt"] if data else None


def is_valid_persona_id(pid: str) -> bool:
    return pid in _get_registry()


def list_available_personas() -> List[str]:
    return list(_get_registry().keys())
