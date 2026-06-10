import logging
from typing import Any, Dict, List, Optional

from app.advisor_skills import AdvisorSkill, get_advisor_skill
from app.llm.classifier import classify_advisor_skill
from app.models.persona import Persona
from app.core.session_manager import get_session_manager
from app.rag.persona_context_builder import PersonaContextBuilder
from app.llm.clients.llm_client import LLMClient
from app.llm import llm_tasks
from app.llm.responses import generate_single_persona_response

logger = logging.getLogger(__name__)

class ImprovedChatOrchestrator:
    """
    Enhanced orchestrator with document awareness and improved context handling.

    Coordinates personas, tool dispatch, clarification, and response
    generation. LLM-powered tasks live in ``app.llm`` (clarification,
    tool dispatch, persona ranking); document-grounded prompt context is
    built by ``app.rag.persona_context_builder``.
    """

    def __init__(self, llm_client: LLMClient = None):
        self.personas: Dict[str, Persona] = {}
        self.llm_client = llm_client
        self.session_manager = get_session_manager()
        self.context_builder = PersonaContextBuilder()

    def register_persona(self, persona: Persona):
        """Register or update a persona with the orchestrator."""
        is_new = persona.id not in self.personas
        self.personas[persona.id] = persona
        if is_new:
            logger.info(f"Registered persona: {persona.id} ({persona.name})")

    def unregister_persona(self, persona_id: str):
        """Remove a persona from the orchestrator."""
        removed = self.personas.pop(persona_id, None)
        if removed:
            logger.info(f"Unregistered persona: {persona_id} ({removed.name})")

    def get_persona(self, persona_id: str) -> Optional[Persona]:
        """Get a specific persona"""
        return self.personas.get(persona_id)

    def list_personas(self) -> List[str]:
        """List all available persona IDs."""
        return list(self.personas.keys())

    async def get_tool_response(self, user_message: str):
        """Check whether a tool can handle *user_message* (see app.llm.llm_tasks)."""
        return await llm_tasks.run_tool_response(self.llm_client, user_message)

    async def needs_clarification_improved(self, session, user_input: str) -> bool:
        """Decide whether *user_input* is too vague to route (see app.llm.llm_tasks)."""
        return await llm_tasks.needs_clarification_improved(
            self.personas, session, user_input
        )

    async def generate_contextual_clarification(self, user_input: str) -> Dict[str, Any]:
        """Produce a clarifying question and suggestions (see app.llm.llm_tasks)."""
        return await llm_tasks.generate_contextual_clarification(
            self.personas, user_input
        )

    async def classify_advisor_skill(
        self,
        user_input: str,
        session,
        requested_skill_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ):
        """Classify the latest user message into an advisor response skill."""
        has_documents = False
        try:
            stats = session.get_rag_stats()
            has_documents = stats.get("total_documents", 0) > 0
        except Exception:
            has_documents = bool(getattr(session, "uploaded_files", []))

        return await classify_advisor_skill(
            self.llm_client,
            user_input,
            has_documents=has_documents,
            requested_skill_id=requested_skill_id,
            user_id=user_id,
        )

    async def generate_single_persona_response(
        self,
        session,
        persona,
        response_length: str = "medium",
        advisor_skill: Optional[AdvisorSkill] = None,
    ):
        """Generate a document-grounded response from a single persona."""
        return await generate_single_persona_response(
            session,
            persona,
            response_length,
            advisor_skill or get_advisor_skill("quick_advice"),
        )

    def _get_persona_context_keywords(self, persona_id: str) -> str:
        """Persona-specific retrieval keywords (see PersonaContextBuilder)."""
        return self.context_builder.get_persona_context_keywords(persona_id)

    async def chat_with_persona(
        self,
        user_input: str,
        persona_id: str,
        session_id: str,
        response_length: str = "medium",
        advisor_skill_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Chat with a specific persona directly - FIXED for consistent document access
        """
        try:
            persona = self.get_persona(persona_id)
            if not persona:
                return {
                    "error": f"Persona {persona_id} not found",
                    "available_personas": list(self.personas.keys()),
                    "persona_id": persona_id,
                    "persona_name": "Unknown"
                }

            # Ensure session exists and log session info
            session = self.session_manager.get_session(session_id)
            logger.info(f"Chat with {persona_id} using session {session_id}")

            # Add user message to session
            session.append_message("user", user_input)

            classification = await self.classify_advisor_skill(
                user_input,
                session,
                requested_skill_id=advisor_skill_id,
                user_id=user_id,
            )

            # Use the same session_id for document retrieval
            logger.info(f"Generating response for {persona_id} with session {session_id}")

            # Generate response from single persona using consistent session ID
            response_data = await self.generate_single_persona_response(
                session,
                persona,
                response_length,
                classification.skill,
            )

            # Add response to session
            session.append_message(persona_id, response_data["response"])

            # Ensure response data includes all necessary fields
            return {
                "persona_id": persona_id,
                "persona_name": persona.name,
                "response": response_data.get("response", "I'm having trouble generating a response."),
                "used_documents": response_data.get("used_documents", False),
                "document_chunks_used": response_data.get("document_chunks_used", 0),
                "response_length": response_length,
                "advisor_skill": classification.skill_id,
                "advisor_skill_name": classification.skill.name,
                "context_quality": response_data.get("context_quality", "unknown"),
                "session_id": session_id,
                "type": "single_persona_response",
                "persona": {
                    "persona_id": persona_id,
                    "persona_name": persona.name,
                    "response": response_data.get("response", "I'm having trouble generating a response."),
                    "used_documents": response_data.get("used_documents", False),
                    "document_chunks_used": response_data.get("document_chunks_used", 0),
                    "advisor_skill": classification.skill_id,
                    "advisor_skill_name": classification.skill.name,
                }
            }

        except Exception as e:
            logger.error(f"Error in chat_with_persona for {persona_id}: {str(e)}")
            logger.error(f"Session ID: {session_id}")
            import traceback
            logger.error(f"Full traceback: {traceback.format_exc()}")

            return {
                "error": f"Error processing request: {str(e)}",
                "persona_id": persona_id,
                "persona_name": self.personas.get(persona_id, {}).name if persona_id in self.personas else "Unknown",
                "response": "I encountered an error while processing your request. Please try again.",
                "used_documents": False,
                "document_chunks_used": 0,
                "response_length": response_length,
                "context_quality": "error",
                "session_id": session_id,
                "type": "error"
            }

    async def get_top_personas(
        self,
        session_id: str,
        k: int = 3,
        allowed_ids: Optional[List[str]] = None,
        advisor_skill: Optional[AdvisorSkill] = None,
    ) -> List[str]:
        """Rank personas for the session by relevance (see app.llm.llm_tasks)."""
        session = self.session_manager.get_session(session_id)
        preferred_ids = advisor_skill.preferred_advisors if advisor_skill else None
        return await llm_tasks.rank_personas(
            self.personas,
            session,
            k,
            allowed_ids=allowed_ids,
            preferred_ids=preferred_ids,
            llm_client=self.llm_client,
        )
