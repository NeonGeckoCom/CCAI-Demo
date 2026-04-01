# app/core/bootstrap.py
from app.config import get_settings
from app.llm.improved_gemini_client import ImprovedGeminiClient
from app.llm.improved_ollama_client import ImprovedOllamaClient
from app.llm.improved_vllm_client import ImprovedVllmClient
from app.core.improved_orchestrator import ImprovedChatOrchestrator
from app.models.default_personas import get_default_personas

settings = get_settings()

current_provider = "gemini"
available_providers = ["ollama", "gemini", "vllm"]

def create_llm_client(provider=None):
    if provider is None:
        provider = current_provider
    if provider == "gemini":
        return ImprovedGeminiClient(model_name=settings.llm.gemini.model)
    elif provider == "vllm":
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
        return ImprovedOllamaClient(
            model_name=settings.llm.ollama.model,
            base_url=settings.llm.ollama.base_url,
        )

llm = create_llm_client()
chat_orchestrator = ImprovedChatOrchestrator()

DEFAULT_PERSONAS = get_default_personas(llm)
for persona in DEFAULT_PERSONAS:
    chat_orchestrator.register_persona(persona)
