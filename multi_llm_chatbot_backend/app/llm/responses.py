"""Persona response generation.

Generates a document-grounded response from a single persona. Document
context is built by ``app.rag.persona_context_builder``.
"""

import json
import logging
import re
from typing import Any, Awaitable, Callable, Dict, Optional

from app.llm.clients.llm_client import LLMStreamChunk
from app.rag.persona_context_builder import PersonaContextBuilder

logger = logging.getLogger(__name__)

# Stateless helper that turns retrieved documents into persona prompt context.
_context_builder = PersonaContextBuilder()


def _document_sources(document_context: str) -> list[Dict[str, Any]]:
    """Recover structured source records embedded beside retrieved excerpts."""
    context = document_context or ""
    sources: list[Dict[str, Any]] = []
    seen = set()
    seen_filenames = set()
    blocks = re.split(r"(?==== FROM DOCUMENT:)", context)
    for block in blocks:
        title_match = re.search(r"=== FROM DOCUMENT:\s*(.+?)\s*===", block)
        if not title_match:
            continue
        title = title_match.group(1).strip()
        metadata_match = re.search(
            r"=== SOURCE METADATA:\s*(\{.*?\})\s*===",
            block,
        )
        metadata: Dict[str, Any] = {}
        if metadata_match:
            try:
                parsed = json.loads(metadata_match.group(1))
                if isinstance(parsed, dict):
                    metadata = parsed
            except json.JSONDecodeError:
                metadata = {}
        source = {
            "file_id": str(metadata.get("file_id") or ""),
            "file_type": str(metadata.get("file_type") or "unknown"),
            "filename": str(metadata.get("filename") or title),
            "title": str(metadata.get("title") or title),
            "page_numbers": [
                int(value) for value in (metadata.get("page_numbers") or [])
                if str(value).isdigit() and int(value) > 0
            ],
            "slide_numbers": [
                int(value) for value in (metadata.get("slide_numbers") or [])
                if str(value).isdigit() and int(value) > 0
            ],
            "sections": [
                str(value) for value in (metadata.get("sections") or [])
                if str(value).strip()
            ],
            "version_or_upload_date": str(
                metadata.get("version_or_upload_date") or ""
            ),
            "open_route": str(metadata.get("open_route") or ""),
        }
        key = source["file_id"] or source["filename"].casefold()
        filename_key = source["filename"].casefold()
        if key and key not in seen and filename_key not in seen_filenames:
            seen.add(key)
            seen_filenames.add(filename_key)
            sources.append(source)
    return sources


def _list_items(text: str) -> list[str]:
    items = []
    for line in (text or "").splitlines():
        value = re.sub(r"^\s*(?:[-*]|\d+\.)\s*", "", line).strip()
        if value and value.casefold() not in {"none", "none identified", "nothing specific"}:
            items.append(value)
    return items[:6]


def _split_grounding_sections(response: str) -> tuple[str, list[str], list[str]]:
    """Move the model's final assumptions/verification sections into metadata."""
    text = response or ""
    assumptions = []
    verify = []
    marker = re.search(
        r"\n###\s+(?:Important assumptions|Assumptions)\s*\n",
        text,
        flags=re.IGNORECASE,
    )
    if marker:
        answer = text[:marker.start()].rstrip()
        tail = text[marker.end():]
        verify_marker = re.search(
            r"\n###\s+(?:Information to verify|Needs verification|Verify)\s*\n",
            tail,
            flags=re.IGNORECASE,
        )
        if verify_marker:
            assumptions = _list_items(tail[:verify_marker.start()])
            verify = _list_items(tail[verify_marker.end():])
        else:
            assumptions = _list_items(tail)
        return answer, assumptions, verify

    verify_marker = re.search(
        r"\n###\s+(?:Information to verify|Needs verification|Verify)\s*\n",
        text,
        flags=re.IGNORECASE,
    )
    if verify_marker:
        return (
            text[:verify_marker.start()].rstrip(),
            assumptions,
            _list_items(text[verify_marker.end():]),
        )
    return text, assumptions, verify


def _response_grounding(
    session,
    document_context: str,
    assumptions: list[str],
    verify: list[str],
    *,
    retrieved_document_context: str = "",
    response: str = "",
) -> Dict[str, Any]:
    grounding = dict(getattr(session, "response_grounding", {}) or {})
    included_sources = _document_sources(document_context)
    retrieved_sources = _document_sources(retrieved_document_context)
    cited_sources = [
        source
        for source in included_sources
        if (
            (source.get("filename") or "").casefold() in (response or "").casefold()
            or (source.get("title") or "").casefold() in (response or "").casefold()
        )
    ]
    # The visible "Context used" list is stricter than the retrieval trace:
    # only sources the answer actually names are shown to the student.
    grounding["uploaded_documents"] = cited_sources
    grounding["document_source_states"] = {
        "indexed": list(dict.fromkeys(getattr(session, "uploaded_files", []) or [])),
        "retrieved": retrieved_sources,
        "included": included_sources,
        "cited": cited_sources,
    }
    grounding["assumptions"] = assumptions
    grounding["verify"] = verify
    grounding["general_guidance_only"] = not bool(
        grounding.get("plan_context")
        or cited_sources
        or grounding.get("meeting_notes")
    )
    return grounding


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
            user_message = (
                getattr(session, "response_user_message", None)
                or session.get_latest_user_message()
                or ""
            )
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
            session,
            persona,
            user_message,
            document_context,
            response_length=response_length,
            advisor_skill=advisor_skill,
        )
        included_document_context = enhanced_context.included_document_context

        # If you only want the user/system text readable:
        for msg in enhanced_context:
            logger.info("Generating response role=%s:\n%s", msg["role"], msg["content"])

        if getattr(session, "response_user_message", None):
            enhanced_context.append({"role": "user", "content": user_message})
        response = await persona.respond(enhanced_context, response_length, advisor_skill)

        if not _is_valid_response(response, persona.id):
            logger.warning("Invalid response from %s, using fallback", persona.id)
            response = _get_persona_fallback(persona.id)

        response, assumptions, verify = _split_grounding_sections(response)
        used_documents = bool(included_document_context and len(included_document_context.strip()) > 100)
        document_chunks_used = included_document_context.count("[Document excerpt]") if included_document_context else 0

        return {
            "persona_id": persona.id,
            "persona_name": persona.name,
            "response": response,
            "used_documents": used_documents,
            "document_chunks_used": document_chunks_used,
            "response_length": response_length,
            "advisor_skill": getattr(advisor_skill, "id", advisor_skill),
            "context_quality": "high" if included_document_context else "conversation_only",
            "model_name": getattr(persona.llm, "model_name", ""),
            "grounding": _response_grounding(
                session,
                included_document_context,
                assumptions,
                verify,
                retrieved_document_context=document_context,
                response=response,
            ),
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
            "model_name": getattr(persona.llm, "model_name", ""),
            "grounding": _response_grounding(session, "", [], []),
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
            user_message = (
                getattr(session, "response_user_message", None)
                or session.get_latest_user_message()
                or ""
            )
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
            session,
            persona,
            user_message,
            document_context,
            response_length=response_length,
            advisor_skill=advisor_skill,
        )
        included_document_context = enhanced_context.included_document_context

        for msg in enhanced_context:
            logger.info("Generating streamed response role=%s:\n%s", msg["role"], msg["content"])

        if getattr(session, "response_user_message", None):
            enhanced_context.append({"role": "user", "content": user_message})
        response = await persona.respond_stream(
            enhanced_context,
            response_length,
            advisor_skill,
            on_chunk=on_chunk,
        )

        if not _is_valid_response(response, persona.id, enforce_length=False):
            logger.warning("Invalid streamed response from %s, using fallback", persona.id)
            response = _get_persona_fallback(persona.id)

        response, assumptions, verify = _split_grounding_sections(response)
        used_documents = bool(included_document_context and len(included_document_context.strip()) > 100)
        document_chunks_used = included_document_context.count("[Document excerpt]") if included_document_context else 0

        return {
            "persona_id": persona.id,
            "persona_name": persona.name,
            "response": response,
            "used_documents": used_documents,
            "document_chunks_used": document_chunks_used,
            "response_length": response_length,
            "advisor_skill": getattr(advisor_skill, "id", advisor_skill),
            "context_quality": "high" if included_document_context else "conversation_only",
            "model_name": getattr(persona.llm, "model_name", ""),
            "grounding": _response_grounding(
                session,
                included_document_context,
                assumptions,
                verify,
                retrieved_document_context=document_context,
                response=response,
            ),
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
            "model_name": getattr(persona.llm, "model_name", ""),
            "grounding": _response_grounding(session, "", [], []),
        }
