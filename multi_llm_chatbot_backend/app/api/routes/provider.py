from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import get_current_active_user
from app.core.bootstrap import (
    AVAILABLE_BACKENDS,
    _is_backend_enabled,
    chat_orchestrator,
    get_llm_client,
)
from app.core.database import get_database
from app.models.user import User, UserLLMConfig

router = APIRouter()


@router.get("/current-provider")
async def get_current_provider(
    current_user: User = Depends(get_current_active_user),
):
    """Return the authenticated user's saved LLM configuration."""
    config = current_user.llm_config or UserLLMConfig()
    return {
        "llm_config": config.model_dump(),
        "available_backends": AVAILABLE_BACKENDS,
    }


@router.post("/switch-provider")
async def switch_provider(
    llm_config: UserLLMConfig,
    current_user: User = Depends(get_current_active_user),
):
    """Validate and persist a user's uniform or hybrid backend selection."""
    if llm_config.mode == "hybrid" and llm_config.persona_backends:
        registered = set(chat_orchestrator.personas)
        unknown = set(llm_config.persona_backends) - registered
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Unknown persona IDs: {sorted(unknown)}. "
                    f"Valid IDs: {sorted(registered)}"
                ),
            )

        locked = {
            persona_id
            for persona_id in llm_config.persona_backends
            if chat_orchestrator.personas[persona_id].backend_locked
        }
        if locked:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot override backend for locked advisors: {sorted(locked)}",
            )

    backends_to_check = {llm_config.default_backend}
    if llm_config.orchestrator_backend:
        backends_to_check.add(llm_config.orchestrator_backend)
    if llm_config.persona_backends:
        backends_to_check.update(llm_config.persona_backends.values())

    for backend in backends_to_check:
        if not _is_backend_enabled(backend):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Backend {backend!r} is disabled by the administrator.",
            )
        try:
            get_llm_client(backend)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Backend {backend!r} is not configured: {exc}",
            )

    db = get_database()
    await db.users.update_one(
        {"_id": current_user.id},
        {"$set": {"llm_config": llm_config.model_dump()}},
    )

    return {
        "message": "LLM configuration updated",
        "llm_config": llm_config.model_dump(),
    }
