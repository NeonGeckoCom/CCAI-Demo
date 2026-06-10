from fastapi import APIRouter, Body, HTTPException
from app.core.bootstrap import chat_orchestrator
from app.llm.clients import provider_manager
from app.models.default_personas import get_default_personas
from app.models.provider import ProviderSwitch

router = APIRouter()


@router.get("/current-provider")
async def get_current_provider():
    current_llm = chat_orchestrator.llm_client
    return {
        "current_provider": provider_manager.get_current_provider(),
        "available_providers": provider_manager.available_providers,
        "model_info": {
            "name": current_llm.model_name if hasattr(current_llm, 'model_name') else "gemini-2.0-flash",
            "provider": provider_manager.get_current_provider(),
        }
    }

@router.post("/switch-provider")
async def switch_provider(provider_data: ProviderSwitch):
    if provider_data.provider not in provider_manager.available_providers:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider_data.provider}. Available: {provider_manager.available_providers}")

    try:
        provider_manager.set_current_provider(provider_data.provider)
        new_llm = provider_manager.create_llm_client(provider_data.provider)

        chat_orchestrator.llm_client = new_llm

        new_personas = get_default_personas(new_llm)
        for pid in list(chat_orchestrator.personas):
            chat_orchestrator.unregister_persona(pid)
        for persona in new_personas:
            chat_orchestrator.register_persona(persona)

        return {
            "message": f"Successfully switched to {provider_manager.get_current_provider()}",
            "current_provider": provider_manager.get_current_provider(),
            "model_info": {
                "name": new_llm.model_name if hasattr(new_llm, 'model_name') else "gemini-2.0-flash",
                "provider": provider_manager.get_current_provider(),
            }
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to switch to {provider_data.provider}: {str(e)}")

@router.post("/switch-model")
async def switch_model(model_name: str = Body(...)):
    if "gemini" in model_name.lower():
        return await switch_provider(ProviderSwitch(provider="gemini"))
    else:
        return await switch_provider(ProviderSwitch(provider="ollama"))

@router.get("/current-model")
async def get_current_model():
    current_llm = chat_orchestrator.llm_client
    model_name = current_llm.model_name if hasattr(current_llm, 'model_name') else "gemini-2.0-flash"
    return {
        "model": model_name,
        "provider": provider_manager.get_current_provider(),
    }
