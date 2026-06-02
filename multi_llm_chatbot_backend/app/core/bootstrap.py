# app/core/bootstrap.py
from app.llm.clients.provider_manager import create_llm_client
from app.llm.improved_orchestrator import ImprovedChatOrchestrator
from app.models.default_personas import get_default_personas

llm = create_llm_client()
chat_orchestrator = ImprovedChatOrchestrator(llm_client=llm)

DEFAULT_PERSONAS = get_default_personas(llm)
for persona in DEFAULT_PERSONAS:
    chat_orchestrator.register_persona(persona)
