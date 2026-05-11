"""BrainForge persona sync — fetches models and personas from the BrainForge
API and registers them as advisors in the orchestrator.

Called at startup and run periodically via a background loop.
"""

import logging
from typing import List

import httpx

from app.config import get_settings
from app.llm.brainforge_auth import BrainForgeAuthManager
from app.llm.improved_brainforge_client import ImprovedBrainForgeClient
from app.models.persona import Persona

logger = logging.getLogger(__name__)

PERSONA_ID_PREFIX = "bf"
SKIP_PERSONA_NAMES = {"vanilla"}


def _make_persona_id(model_name: str, persona_name: str) -> str:
    """Generate a stable, unique persona ID like 'bf_neonai_NeonAI'."""
    short_model = model_name.rsplit("/", 1)[-1].lower()
    return f"{PERSONA_ID_PREFIX}_{short_model}_{persona_name}"


async def fetch_brainforge_models(auth: BrainForgeAuthManager, api_url: str) -> list:
    """Fetch all models and their personas from BrainForge."""
    try:
        token = await auth.get_token()
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{api_url}/brainforge/get_models",
                headers={"Authorization": f"Bearer {token}"},
            )

        if resp.status_code != 200:
            logger.warning("BrainForge get_models returned %s", resp.status_code)
            return []

        return resp.json().get("models", [])

    except Exception as exc:
        logger.warning("Failed to fetch BrainForge models: %s", exc)
        return []


def build_brainforge_personas(
    models: list,
    auth: BrainForgeAuthManager,
    api_url: str,
) -> List[Persona]:
    """Build Persona objects from BrainForge model/persona data."""
    personas = []

    for model in models:
        model_name = model.get("name", "")
        model_version = model.get("version", "")
        model_id = f"{model_name}@{model_version}"

        for p in model.get("personas", []):
            persona_name = p.get("persona_name", "")

            if persona_name.lower() in SKIP_PERSONA_NAMES:
                continue

            if not p.get("enabled", True):
                continue

            system_prompt = p.get("system_prompt") or p.get("description") or ""
            if not system_prompt:
                logger.debug(
                    "Skipping BrainForge persona %s (no prompt)", persona_name
                )
                continue

            pid = _make_persona_id(model_name, persona_name)

            llm_client = ImprovedBrainForgeClient(
                api_url=api_url,
                username="",
                password="",
                model_id=model_id,
                auth_manager=auth,
            )

            persona = Persona(
                id=pid,
                name=persona_name,
                system_prompt=system_prompt,
                llm=llm_client,
                temperature=5,
            )
            personas.append(persona)

    return personas


async def async_sync_brainforge_personas(orchestrator) -> int:
    """Async version of sync_brainforge_personas for use within a running event loop."""
    settings = get_settings()
    bf_config = settings.llm.brainforge

    if not bf_config.api_url:
        logger.debug("BrainForge not configured, skipping persona sync")
        return 0

    if not bf_config.username or not bf_config.password:
        logger.warning("BrainForge credentials not set, skipping persona sync")
        return 0

    api_url = bf_config.api_url.rstrip("/")
    auth = BrainForgeAuthManager(api_url, bf_config.username, bf_config.password)

    models = await fetch_brainforge_models(auth, api_url)
    if not models:
        logger.warning("No BrainForge models available, no personas registered")
        return 0

    personas = build_brainforge_personas(models, auth, api_url)

    for persona in personas:
        orchestrator.register_persona(persona)

    logger.info("Registered %d BrainForge personas", len(personas))
    return len(personas)
