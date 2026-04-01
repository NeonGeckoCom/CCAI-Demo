from fastapi import APIRouter, Body, HTTPException
from app.config import get_settings
from app.llm.improved_gemini_client import ImprovedGeminiClient
from app.llm.improved_ollama_client import ImprovedOllamaClient
from app.llm.improved_vllm_client import ImprovedVllmClient
from app.models.default_personas import get_default_personas
from app.core.bootstrap import chat_orchestrator, llm, current_provider, available_providers
from pydantic import BaseModel
import os
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

def create_llm_client(provider: str = None):
    global current_provider
    if provider is None:
        provider = current_provider

    if provider == "gemini":
        try:
            return ImprovedGeminiClient(model_name=os.getenv("GEMINI_MODEL"))
        except ValueError as e:
            logger.warning(f"Gemini API key not found, falling back to Ollama: {e}")
            return ImprovedOllamaClient(model_name="llama3.2:1b")
    elif provider == "ollama":
        return ImprovedOllamaClient(model_name="llama3.2:1b")
    elif provider == "vllm":
        settings = get_settings()
        if not settings.llm.vllm.clients:
            raise ValueError("No vLLM endpoints configured. Add entries under llm.vllm.clients in your config.")
        # TODO: Currently selects the first configured vLLM endpoint.
        # Future improvement: more sophisticated selection logic.
        first_client = next(iter(settings.llm.vllm.clients.values()))
        return ImprovedVllmClient(
            api_url=first_client.api_url,
            api_key=first_client.api_key,
        )
    else:
        raise ValueError(f"Unknown provider: {provider}")

# Initialize LLM and personas
llm = create_llm_client(current_provider)
DEFAULT_PERSONAS = get_default_personas(llm)
for persona in DEFAULT_PERSONAS:
    chat_orchestrator.register_persona(persona)

class ProviderSwitch(BaseModel):
    provider: str

@router.get("/current-provider")
async def get_current_provider():
    return {
        "current_provider": current_provider,
        "available_providers": available_providers,
        "model_info": {
            "name": llm.model_name if hasattr(llm, 'model_name') else "gemini-2.0-flash",
            "provider": current_provider
        }
    }

@router.post("/switch-provider")
async def switch_provider(provider_data: ProviderSwitch):
    global current_provider, llm

    if provider_data.provider not in available_providers:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider_data.provider}. Available: {available_providers}")

    try:
        current_provider = provider_data.provider
        new_llm = create_llm_client(current_provider)
        llm = new_llm

        new_personas = get_default_personas(new_llm)
        chat_orchestrator.personas.clear()
        for persona in new_personas:
            chat_orchestrator.register_persona(persona)

        return {
            "message": f"Successfully switched to {current_provider}",
            "current_provider": current_provider,
            "model_info": {
                "name": new_llm.model_name if hasattr(new_llm, 'model_name') else "gemini-2.0-flash",
                "provider": current_provider
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
    model_name = llm.model_name if hasattr(llm, 'model_name') else "gemini-2.0-flash"
    return {
        "model": model_name,
        "provider": current_provider
    }
