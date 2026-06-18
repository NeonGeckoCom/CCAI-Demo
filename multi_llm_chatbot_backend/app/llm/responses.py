"""Persona response generation.

Generates a document-grounded response from a single persona. Document
context is built by ``app.rag.persona_context_builder``.
"""

import json
import logging
from typing import Any, Awaitable, Callable, Dict, Optional

from app.llm.clients.llm_client import LLMStreamChunk
from app.rag.persona_context_builder import PersonaContextBuilder

logger = logging.getLogger(__name__)

# Stateless helper that turns retrieved documents into persona prompt context.
_context_builder = PersonaContextBuilder()


def _is_valid_response(response: str, persona_id: str, *, enforce_length: bool = True) -> bool:
    """Validate response quality."""
    if len(response) < 10 or (enforce_length and len(response) > 5000):
        return False

    confusion_indicators = [
        f"Thank you, Dr. {persona_id.title()}",
        "Assistant:",
        f"Dr. {persona_id.title()} Advisor:",
        "excellent discussion, Assistant",
    ]

    return not any(indicator in response for indicator in confusion_indicators)


def _get_persona_fallback(persona_id: str) -> str:
    """Get persona-specific fallback responses."""
    fallbacks = {
        "methodologist": "I'd be happy to help with your research methodology. What specific methodological approach are you considering?",
        "theorist": "I'd like to explore the theoretical foundation of your work. What conceptual framework guides your research?",
        "pragmatist": "Let's take a practical approach. What's the most pressing decision you need to make about your research right now?",
    }
    return fallbacks.get(persona_id, "I'd be happy to help. Could you provide more specific details about your question?")


async def generate_single_persona_response(
    session,
    persona,
    response_length: str = "medium",
    advisor_skill=None,
) -> Dict[str, Any]:
    """Generate a response from a single persona with enhanced RAG integration."""
    try:
        user_message = ""
        try:
            user_message = session.get_latest_user_message() or ""
        except AttributeError:
            for msg in reversed(session.messages):
                if msg.get("role") == "user":
                    user_message = msg.get("content", "")
                    break

        document_context = ""
        if user_message:
            document_context = await _context_builder.retrieve_relevant_documents(
                user_input=user_message,
                session_id=session.session_id,
                persona_id=persona.id,
                llm_client=persona.llm,
            )

        enhanced_context = await _context_builder.build_enhanced_context_for_persona(
            session, persona, user_message, document_context
        )

        # If you only want the user/system text readable:
        for msg in enhanced_context:
            logger.info("Generating response role=%s:\n%s", msg["role"], msg["content"])

        response = await persona.respond(enhanced_context, response_length, advisor_skill)

        if not _is_valid_response(response, persona.id):
            logger.warning("Invalid response from %s, using fallback", persona.id)
            response = _get_persona_fallback(persona.id)

        used_documents = bool(document_context and len(document_context.strip()) > 100)
        document_chunks_used = document_context.count("[Source:") if document_context else 0

        return {
            "persona_id": persona.id,
            "persona_name": persona.name,
            "response": response,
            "used_documents": used_documents,
            "document_chunks_used": document_chunks_used,
            "response_length": response_length,
            "advisor_skill": getattr(advisor_skill, "id", advisor_skill),
            "context_quality": "high" if document_context else "conversation_only",
        }

    except Exception as exc:
        logger.error("Error generating response for %s: %s", persona.id, exc)
        return {
            "persona_id": persona.id,
            "persona_name": persona.name,
            "response": f"I apologize, but I'm having technical difficulties. {_get_persona_fallback(persona.id)}",
            "used_documents": False,
            "document_chunks_used": 0,
            "response_length": response_length,
            "advisor_skill": getattr(advisor_skill, "id", advisor_skill),
            "context_quality": "error",
        }


async def generate_single_persona_response_stream(
    session,
    persona,
    response_length: str = "medium",
    advisor_skill=None,
    on_chunk: Optional[Callable[[LLMStreamChunk], Awaitable[None]]] = None,
    on_stage: Optional[Callable[[str, Dict[str, str]], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """Generate a document-grounded response while streaming model chunks."""
    try:
        user_message = ""
        try:
            user_message = session.get_latest_user_message() or ""
        except AttributeError:
            for msg in reversed(session.messages):
                if msg.get("role") == "user":
                    user_message = msg.get("content", "")
                    break

        document_context = ""
        if user_message:
            document_context = await _context_builder.retrieve_relevant_documents(
                user_input=user_message,
                session_id=session.session_id,
                persona_id=persona.id,
                llm_client=persona.llm,
                on_stage=on_stage,
            )

        enhanced_context = await _context_builder.build_enhanced_context_for_persona(
            session, persona, user_message, document_context
        )

        for msg in enhanced_context:
            logger.info("Generating streamed response role=%s:\n%s", msg["role"], msg["content"])

        response = await persona.respond_stream(
            enhanced_context,
            response_length,
            advisor_skill,
            on_chunk=on_chunk,
        )

        if not _is_valid_response(response, persona.id, enforce_length=False):
            logger.warning("Invalid streamed response from %s, using fallback", persona.id)
            response = _get_persona_fallback(persona.id)

        used_documents = bool(document_context and len(document_context.strip()) > 100)
        document_chunks_used = document_context.count("[Source:") if document_context else 0

        return {
            "persona_id": persona.id,
            "persona_name": persona.name,
            "response": response,
            "used_documents": used_documents,
            "document_chunks_used": document_chunks_used,
            "response_length": response_length,
            "advisor_skill": getattr(advisor_skill, "id", advisor_skill),
            "context_quality": "high" if document_context else "conversation_only",
        }

    except Exception as exc:
        logger.error("Error streaming response for %s: %s", persona.id, exc)
        fallback = f"I apologize, but I'm having technical difficulties. {_get_persona_fallback(persona.id)}"
        if on_chunk:
            await on_chunk(LLMStreamChunk(text=fallback, kind="text"))
        return {
            "persona_id": persona.id,
            "persona_name": persona.name,
            "response": fallback,
            "used_documents": False,
            "document_chunks_used": 0,
            "response_length": response_length,
            "advisor_skill": getattr(advisor_skill, "id", advisor_skill),
            "context_quality": "error",
        }
