import asyncio
import logging
import traceback
from typing import Any, Dict

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.api.routes.chat_sessions import persist_message
from app.api.utils import get_or_create_session_for_request_async
from app.core.auth import get_current_active_user
from app.config import get_settings
from app.core.bootstrap import chat_orchestrator
from app.core.database import get_database
from app.core.persona_filter import get_available_persona_ids, select_persona_ids
from app.core.session_manager import get_session_manager
from app.models.persona import Persona as ChatPersona
from app.models.user import PersistMessage, ReplyToRef, User
from app.models.chat import (
    ChatMessage,
    ChatStreamLine,
    NewChatRequest,
    PersonaQuery,
    ReplyToAdvisor,
    SwitchChatRequest,
    UserInput,
)

logger = logging.getLogger(__name__)

router = APIRouter()
session_manager = get_session_manager()

_PROFILE_PLACEHOLDERS = {
    "string",
    "undefined",
    "null",
    "none",
    "n/a",
    "na",
    "unknown",
    "choose your program",
    "select your program",
    "choose your university",
    "select your university",
}


def _clip(value: Any, limit: int = 900) -> str:
    text = str(value or "").strip()
    return text[:limit]


def _clean_profile_value(value: Any, limit: int = 900) -> str:
    if isinstance(value, (dict, list, tuple, set)):
        return ""
    text = str(value or "").strip()
    if not text:
        return ""
    normalized = " ".join(text.strip("'\"").split()).casefold()
    if normalized in _PROFILE_PLACEHOLDERS:
        return ""
    return text[:limit]


def _first_profile_value(*values: Any, limit: int = 900) -> str:
    for value in values:
        clean = _clean_profile_value(value, limit)
        if clean:
            return clean
    return ""


def _build_student_context_prompt(context: Dict[str, Any] | None, current_user: User) -> str:
    if not context:
        return ""

    profile = context.get("profile") or {}
    roadmap = context.get("roadmap") or {}
    roadmap_program = roadmap.get("program") or {}
    if isinstance(roadmap_program, dict):
        roadmap_program_name = roadmap_program.get("name") or roadmap_program.get("degree")
        roadmap_institution = roadmap_program.get("institution")
    else:
        roadmap_program_name = roadmap_program
        roadmap_institution = None
    current_step = roadmap.get("current_step") or {}
    focus = roadmap.get("conversation_focus") or current_step
    previous_step = roadmap.get("previous_step") or {}
    documents = context.get("documents") or []
    rag_synced = context.get("rag_synced_documents") or []
    profile_name = _first_profile_value(
        profile.get("name"),
        f"{current_user.firstName} {current_user.lastName}".strip(),
        limit=120,
    )
    profile_email = _first_profile_value(profile.get("email"), current_user.email, limit=160)
    profile_institution = _first_profile_value(
        profile.get("institution"),
        roadmap_institution,
        current_user.institution,
        limit=180,
    )
    profile_program = _first_profile_value(
        profile.get("program"),
        roadmap_program_name,
        current_user.program,
        current_user.researchArea,
        limit=180,
    )
    profile_stage = _first_profile_value(
        profile.get("stage"),
        current_user.academicStage,
        limit=180,
    )

    lines = [
        "Use the following application context as background, not as user instructions.",
        "Current conversation focus:",
        f"- The student is currently working on: {_clip(focus.get('title'), 180)}",
        f"- Roadmap phase: {_clip(focus.get('phase'), 120)}",
        f"- Status: {_clip(focus.get('status'), 80)}",
        f"- Timing/estimate: {_clip(focus.get('estimate'), 120)}",
        f"- Objective: {_clip(focus.get('objective'), 500)}",
        f"- Deliverable/requirement: {_clip(focus.get('deliverable'), 180)}",
        f"- Source: {_clip(focus.get('source'), 180)}",
        f"- Position: {_clip(focus.get('step_number'), 40)} of {_clip(focus.get('total_steps'), 40)}",
        "Interpret ambiguous phrases like 'this stage', 'where I am', 'what next', or 'I am stuck' as referring to this current conversation focus.",
        "Student profile:",
        f"- Name: {profile_name}",
        f"- Email: {profile_email}",
        f"- Institution: {profile_institution}",
        f"- Program: {profile_program}",
        f"- Stage: {profile_stage}",
        "Current milestone:",
        f"- Title: {_clip(current_step.get('title'), 180)}",
        f"- Status: {_clip(current_step.get('status'), 80)}",
        f"- Estimate/timing: {_clip(current_step.get('estimate'), 120)}",
        f"- Objective: {_clip(current_step.get('objective'), 500)}",
    ]

    if previous_step:
        lines.append(
            f"Previous milestone: {_clip(previous_step.get('title'), 160)}"
        )

    subtasks = focus.get("subtasks") or current_step.get("subtasks") or []
    if subtasks:
        lines.append("Current focus subtasks:")
        lines.extend(f"  - {_clip(item, 240)}" for item in subtasks[:8])

    upcoming = roadmap.get("upcoming_steps") or []
    if upcoming:
        lines.append("Upcoming milestones:")
        for step in upcoming[:4]:
            estimate = _clip(step.get("estimate"), 80)
            estimate_note = f" ({estimate})" if estimate else ""
            lines.append(
                f"- {_clip(step.get('title'), 160)}{estimate_note}: "
                f"{_clip(step.get('objective'), 240)}"
            )

    if documents:
        lines.append("Documents known in the frontend Documents tab:")
        for doc in documents[:12]:
            words = doc.get("word_count")
            word_note = f", ~{words} words" if words else ""
            lines.append(
                f"- {_clip(doc.get('name') or doc.get('file_name'), 180)}"
                f" ({_clip(doc.get('kind'), 60)}; {_clip(doc.get('source'), 80)}{word_note})"
            )

    if rag_synced:
        lines.append("Documents synced to backend RAG for this chat session:")
        lines.extend(f"- {_clip(name, 180)}" for name in rag_synced[:12])

    return "\n".join(line for line in lines if line is not None)

@router.post("/chat-stream")
async def chat_stream(
    message: ChatMessage,
    request: Request,
    current_user: User = Depends(get_current_active_user),
) -> StreamingResponse:
    """
    Streaming chat endpoint (newline-delimited JSON).
    @param message: ChatMessage containing user input and optional session/chat IDs
    @param request: FastAPI Request object for session management
    @param current_user: Authenticated user from dependency injection
    @return: StreamingResponse that yields ChatStreamLine events as NDJSON
    """

    async def _event_generator():
        try:
            # Load or create the in-memory session
            if message.chat_session_id:
                sid = f"chat_{message.chat_session_id}"
                if sid not in session_manager.sessions:
                    sid = await get_or_create_session_for_request_async(
                        request,
                        chat_session_id=message.chat_session_id,
                        user_id=str(current_user.id),
                    )
            else:
                sid = await get_or_create_session_for_request_async(request)

            session = session_manager.get_session(sid)
            session.student_context_prompt = _build_student_context_prompt(
                message.student_context,
                current_user,
            )

            # Append the accumulated per-user knowledge markdown (learned from
            # uploaded documents, linked pages, and wellbeing check-ins).
            try:
                from app.core.library import get_knowledge_context_block

                knowledge_block = await get_knowledge_context_block(str(current_user.id))
                if knowledge_block:
                    base_prompt = session.student_context_prompt or ""
                    session.student_context_prompt = (
                        f"{base_prompt}\n\n{knowledge_block}".strip()
                    )
            except Exception as knowledge_error:
                logger.warning("Could not attach knowledge context: %s", knowledge_error)

            # Append user message to in-memory session and persist to MongoDB
            session.append_message("user", message.user_input)
            if message.chat_session_id:
                await persist_message(
                    message.chat_session_id,
                    PersistMessage(
                        id=message.user_message_id or str(ObjectId()),
                        type="user",
                        content=message.user_input,
                    ),
                )
                yield ChatStreamLine(
                    type="progress", data={"phase": "received"},
                ).to_ndjson()

            yield ChatStreamLine(
                type="progress",
                data={"phase": "routing_request"},
            ).to_ndjson()

            # Tool routing is temporarily disabled while this stage does not
            # use external tools. Re-enable by restoring the get_tool_response
            # pass before advisor selection.
            # tool_result = await chat_orchestrator.get_tool_response(message.user_input)

            skill_classification = await chat_orchestrator.classify_advisor_skill(
                message.user_input,
                session,
                requested_skill_id=message.advisor_skill,
                user_id=str(current_user.id),
            )

            if skill_classification.needs_clarification:
                yield ChatStreamLine(
                    type="progress",
                    data={"phase": "preparing_clarification"},
                ).to_ndjson()
                clarification_message = PersistMessage(
                    id=str(ObjectId()),
                    type="clarification",
                    content=skill_classification.clarification_question,
                    suggestions=skill_classification.clarification_suggestions,
                )
                if message.chat_session_id:
                    await persist_message(message.chat_session_id, clarification_message)
                yield ChatStreamLine(
                    type="clarification",
                    data={
                        "message": skill_classification.clarification_question,
                        "suggestions": skill_classification.clarification_suggestions,
                    },
                ).to_ndjson()
                yield ChatStreamLine(
                    type="progress",
                    data={"phase": "complete"},
                ).to_ndjson()
                return

            # Filter personas by system whitelist and user preferences
            available = get_available_persona_ids(
                registered_ids=chat_orchestrator.list_personas(),
                system_allowed=get_settings().personas.allowed_advisors,
                user_disabled=current_user.disabled_advisors,
            )

            # Ephemeral personas for real committee members (Defense Room adds
            # them client-side with public profiles). They exist only for this
            # request and speak as themselves, grounded in their profile.
            custom_map = {}
            for adv in (message.custom_advisors or [])[:3]:
                cid = str(adv.get("id") or "").strip()
                cname = str(adv.get("name") or "").strip()
                if not cid.startswith("real-") or not cname:
                    continue
                title = str(adv.get("title") or "").strip()
                institution = str(adv.get("institution") or "").strip()
                areas = ", ".join(str(a) for a in (adv.get("research_areas") or [])[:8])
                summary = str(adv.get("summary") or "").strip()[:2000]
                prompt = (
                    f"You are {cname}"
                    + (f", {title}" if title else "")
                    + (f" at {institution}" if institution else "")
                    + ", serving on a PhD student's dissertation committee. "
                    "Speak in first person as this real academic would: direct, collegial, "
                    "grounded in your own research perspective. "
                    + (f"Your research areas: {areas}. " if areas else "")
                    + (f"Your public profile: {summary} " if summary else "")
                    + "Give the student concrete, honest advice from your disciplinary lens. "
                    "If asked about facts of your career you can't verify, say so plainly "
                    "rather than inventing them."
                )
                custom_map[cid] = ChatPersona(
                    id=cid, name=cname, system_prompt=prompt,
                    llm=chat_orchestrator.llm_client, temperature=5,
                )

            yield ChatStreamLine(
                type="progress",
                data={
                    "phase": "classified",
                    "advisor_skill": skill_classification.skill_id,
                    "advisor_skill_name": skill_classification.skill.name,
                    "confidence": skill_classification.confidence,
                },
            ).to_ndjson()

            # Honor the user's ordered selection. The composer offers up to
            # three advisors in Multiple mode; requests without a selection
            # retain the historical single-advisor fallback. Custom committee
            # ids are pulled out first so the registry selection never sees them.
            requested = message.active_advisors
            custom_selected = [cid for cid in (requested or []) if cid in custom_map]
            regular_requested = [cid for cid in (requested or []) if cid not in custom_map]
            if requested is not None and not regular_requested and custom_selected:
                selected_personas = []  # committee-only chat: no registry fallback
            else:
                selected_personas = select_persona_ids(
                    available,
                    regular_requested if requested is not None else None,
                    max_personas=3,
                )
            selected_personas = (custom_selected + [
                pid for pid in selected_personas if pid not in custom_selected
            ])[:3]

            # Guard against race condition where the selected advisor
            # becomes unavailable (e.g. service update) between preference
            # save and chat request.
            if not selected_personas:
                error_detail = (
                    "None of your selected advisors are currently available. "
                    "Please check your advisor settings and try again."
                )
                if message.chat_session_id:
                    await persist_message(
                        message.chat_session_id,
                        PersistMessage(
                            id=str(ObjectId()),
                            type="error",
                            content=error_detail,
                        ),
                    )
                yield ChatStreamLine(
                    type="error",
                    data={
                        "code": "NO_ADVISORS_AVAILABLE",
                        "detail": error_detail,
                    },
                ).to_ndjson()
                yield ChatStreamLine(
                    type="progress",
                    data={"phase": "complete"},
                ).to_ndjson()
                return

            selected_advisors = [
                custom_map.get(persona_id) or chat_orchestrator.get_persona(persona_id)
                for persona_id in selected_personas
            ]
            selected_names = [
                persona.name if persona else persona_id
                for persona_id, persona in zip(selected_personas, selected_advisors)
            ]
            yield ChatStreamLine(
                type="progress",
                data={
                    "phase": "advisor_selected",
                    "persona_id": selected_personas[0],
                    "persona_name": selected_names[0],
                    "persona_ids": selected_personas,
                    "persona_names": selected_names,
                },
            ).to_ndjson()

            event_queue: asyncio.Queue = asyncio.Queue()

            async def _run(pid: str) -> None:
                persona = None
                advisor_message_id = str(ObjectId())
                thought_chunks = []

                async def _put_line(event_type: str, data: dict) -> None:
                    await event_queue.put(ChatStreamLine(type=event_type, data=data))

                try:
                    # Guard against the persona being removed mid-request — return a
                    # fallback response instead of crashing and hanging the stream.
                    persona = custom_map.get(pid) or chat_orchestrator.get_persona(pid)
                    if persona is None:
                        logger.warning("Persona %s was unregistered before response generation", pid)
                        await event_queue.put({
                            "_done": True,
                            "result": {
                                "message_id": advisor_message_id,
                                "persona_id": pid,
                                "persona_name": pid,
                                "response": "This advisor is temporarily unavailable. Please try again.",
                                "thoughts": None,
                                "used_documents": False,
                                "document_chunks_used": 0,
                            },
                        })
                        return

                    await _put_line(
                        "advisor_start",
                        {
                            "message_id": advisor_message_id,
                            "persona_id": pid,
                            "persona_name": persona.name,
                            "advisor_skill": skill_classification.skill_id,
                            "advisor_skill_name": skill_classification.skill.name,
                        },
                    )

                    async def on_chunk(chunk) -> None:
                        if chunk.kind == "thought":
                            thought_chunks.append(chunk.text)
                            await _put_line(
                                "advisor_thought_delta",
                                {
                                    "message_id": advisor_message_id,
                                    "persona_id": pid,
                                    "delta": chunk.text,
                                },
                            )
                            return

                        await _put_line(
                            "advisor_delta",
                            {
                                "message_id": advisor_message_id,
                                "persona_id": pid,
                                "delta": chunk.text,
                            },
                        )

                    async def on_stage(phase: str, data: dict) -> None:
                        await _put_line("progress", {"phase": phase, **(data or {})})

                    result = await chat_orchestrator.generate_single_persona_response_stream(
                        session, persona,
                        message.response_length or "medium",
                        skill_classification.skill,
                        on_chunk=on_chunk,
                        on_stage=on_stage,
                    )
                    result["message_id"] = advisor_message_id
                    result["thoughts"] = "".join(thought_chunks).strip() or None
                    session.append_message(pid, result["response"])
                    await event_queue.put({"_done": True, "result": result})
                except Exception as e:
                    logger.exception(f"chat-stream _run failed for {pid}: {e}")
                    await event_queue.put({
                        "_done": True,
                        "result": {
                            "message_id": advisor_message_id,
                            "persona_id": pid,
                            "persona_name": getattr(persona, "name", pid),
                            "response": f"I ran into a technical issue. Please try again. ({e!s})",
                            "thoughts": "".join(thought_chunks).strip() or None,
                            "used_documents": False,
                            "document_chunks_used": 0,
                        },
                    })

            tasks = [asyncio.create_task(_run(pid)) for pid in selected_personas]

            completed = 0
            memory_responses = []
            while completed < len(tasks):
                event = await event_queue.get()
                if isinstance(event, ChatStreamLine):
                    yield event.to_ndjson()
                    continue

                completed += 1
                result = event["result"]
                memory_responses.append({
                    "name": result.get("persona_name") or result.get("persona_id") or "Advisor",
                    "response": result.get("response") or "",
                })
                if message.chat_session_id:
                    await persist_message(
                        message.chat_session_id,
                        PersistMessage(
                            id=result["message_id"],
                            type="advisor",
                            persona_id=result["persona_id"],
                            advisorName=result["persona_name"],
                            content=result["response"],
                            used_documents=result.get("used_documents", False),
                            document_chunks_used=result.get("document_chunks_used", 0),
                            advisor_skill=result.get("advisor_skill") or skill_classification.skill_id,
                            advisor_skill_name=skill_classification.skill.name,
                            thoughts=result.get("thoughts"),
                        ),
                    )
                line = ChatStreamLine(
                    type="advisor",
                    data={
                        "message_id": result["message_id"],
                        "persona_id": result["persona_id"],
                        "persona_name": result["persona_name"],
                        "content": result["response"],
                        "thoughts": result.get("thoughts"),
                        "used_documents": result.get("used_documents", False),
                        "document_chunks_used": result.get("document_chunks_used", 0),
                        "advisor_skill": result.get("advisor_skill") or skill_classification.skill_id,
                        "advisor_skill_name": skill_classification.skill.name,
                    },
                )
                yield line.to_ndjson()

            await asyncio.gather(*tasks, return_exceptions=True)

            # Distill this exchange into the student's long-term memory notes
            # (background LLM pass; failures never affect the chat itself).
            try:
                from app.core.library import schedule_chat_memory

                schedule_chat_memory(
                    str(current_user.id), message.user_input, memory_responses
                )
            except Exception as memory_error:
                logger.warning("Could not schedule chat memory: %s", memory_error)

            yield ChatStreamLine(
                type="progress",
                data={"phase": "complete"},
            ).to_ndjson()

        except Exception as exc:
            logger.error(f"chat-stream error: {exc}")
            logger.error(traceback.format_exc())
            yield ChatStreamLine(
                type="error",
                data={"detail": str(exc)},
            ).to_ndjson()

    return StreamingResponse(
        _event_generator(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/switch-chat")
async def switch_to_chat(
    request: SwitchChatRequest, 
    req: Request,
    current_user: User = Depends(get_current_active_user)
):
    """
    Switch to an existing chat session and load its context - FIXED VERSION
    Ensures documents are accessible after switching
    """
    try:
        logger.info(f"Switching to chat session: {request.chat_session_id}")
        
        # Load the chat session into memory context with consistent session ID
        memory_session_id = await get_or_create_session_for_request_async(
            req, 
            chat_session_id=request.chat_session_id,
            user_id=str(current_user.id)
        )
        
        if not memory_session_id:
            raise HTTPException(status_code=404, detail="Chat session not found")
        
        logger.info(f"Loaded chat into memory session: {memory_session_id}")
        
        # Get the loaded session
        session = session_manager.get_session(memory_session_id)
        
        # Verify document access after loading
        rag_stats = session.get_rag_stats()
        logger.info(f"After switch - Session {memory_session_id} has {rag_stats.get('total_documents', 0)} documents")
        
        # Get the original MongoDB chat session to retrieve messages in proper format
        db = get_database()
        chat_session = await db.chat_sessions.find_one({
            "_id": ObjectId(request.chat_session_id),
            "user_id": current_user.id,
            "is_active": True
        })
        
        if not chat_session:
            raise HTTPException(status_code=404, detail="Chat session not found in database")
        
        # Return the messages in the original frontend format from MongoDB
        original_messages = chat_session.get("messages", [])
        
        logger.info(f"Switch successful - {len(original_messages)} messages, {rag_stats.get('total_documents', 0)} documents")
        
        return {
            "status": "success",
            "memory_session_id": memory_session_id,
            "chat_session_id": request.chat_session_id,
            "message_count": len(original_messages),
            "context": {
                "messages": original_messages,  # Return original format messages
                "rag_info": rag_stats
            },
            # Include document access verification
            "document_access": {
                "total_documents": rag_stats.get('total_documents', 0),
                "total_chunks": rag_stats.get('total_chunks', 0),
                "documents": rag_stats.get('documents', []),
                "uploaded_files": session.uploaded_files
            },
            "debug_info": {
                "memory_session_format": memory_session_id,
                "documents_accessible": rag_stats.get('total_documents', 0) > 0,
                "session_loaded": memory_session_id in session_manager.sessions
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error switching to chat {request.chat_session_id}: {e}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Failed to switch to chat")

@router.post("/new-chat")
async def create_new_chat(
    request: NewChatRequest,
    req: Request,
    current_user: User = Depends(get_current_active_user)
):
    """
    Create a new chat with fresh context
    """
    try:
        # Create a completely new session (no chat_session_id means fresh context)
        memory_session_id = await get_or_create_session_for_request_async(req)
        
        # Ensure the session is completely clean
        session = session_manager.get_session(memory_session_id)
        session.clear_all_data()  # This clears both messages and documents
        
        return {
            "status": "success",
            "memory_session_id": memory_session_id,
            "message": "New chat created with fresh context",
            "context": {
                "messages": [],
                "rag_info": {"total_documents": 0, "total_chunks": 0}
            }
        }
        
    except Exception as e:
        logger.error(f"Error creating new chat: {e}")
        raise HTTPException(status_code=500, detail="Failed to create new chat")

@router.post("/chat/{persona_id}")
async def chat_with_specific_advisor(persona_id: str, input: UserInput, request: Request):
    """Chat with a specific advisor - UPDATED"""
    try:
        if persona_id not in chat_orchestrator.personas:
            raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' not found")

        # Use async session management
        session_id = await get_or_create_session_for_request_async(request)

        if input.chat_session_id:
            await persist_message(
                input.chat_session_id,
                PersistMessage(
                    type="user",
                    content=input.user_input,
                    isExpandRequest=True,
                ),
            )

        result = await chat_orchestrator.chat_with_persona(
            user_input=input.user_input,
            persona_id=persona_id,
            session_id=session_id,
            advisor_skill_id=input.advisor_skill,
        )
        
        # Handle response structure
        if result.get("type") == "single_persona_response" and "persona" in result:
            persona_data = result["persona"]
            if input.chat_session_id:
                await persist_message(
                    input.chat_session_id,
                    PersistMessage(
                        type="advisor",
                        persona_id=persona_data["persona_id"],
                        advisorName=persona_data["persona_name"],
                        content=persona_data["response"],
                        isExpansion=True,
                        advisor_skill=persona_data.get("advisor_skill"),
                        advisor_skill_name=persona_data.get("advisor_skill_name"),
                    ),
                )
            return {
                "persona": persona_data["persona_name"],
                "persona_id": persona_data["persona_id"],
                "response": persona_data["response"]
            }
        elif "persona_id" in result and "response" in result:
            if input.chat_session_id:
                await persist_message(
                    input.chat_session_id,
                    PersistMessage(
                        type="advisor",
                        persona_id=result["persona_id"],
                        advisorName=result["persona_name"],
                        content=result["response"],
                        isExpansion=True,
                        advisor_skill=result.get("advisor_skill"),
                        advisor_skill_name=result.get("advisor_skill_name"),
                    ),
                )
            return {
                "persona": result["persona_name"],
                "persona_id": result["persona_id"],
                "response": result["response"]
            }
        else:
            error_content = "Sorry, I received an unexpected response format. Please try again."
            if input.chat_session_id:
                await persist_message(
                    input.chat_session_id,
                    PersistMessage(type="error", content=error_content),
                )
            return {
                "persona": "System",
                "response": error_content,
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in chat_with_specific_advisor: {e}")
        error_content = "Sorry, I encountered an error while expanding the message. Please try again."
        if input.chat_session_id:
            await persist_message(
                input.chat_session_id,
                PersistMessage(type="error", content=error_content),
            )
        return {
            "persona": "System",
            "response": error_content,
        }

@router.post("/reply-to-advisor")
async def reply_to_advisor(reply: ReplyToAdvisor, request: Request):
    """Reply to a specific advisor with proper context - UPDATED"""
    try:
        if reply.advisor_id not in chat_orchestrator.personas:
            raise HTTPException(status_code=404, detail=f"Advisor '{reply.advisor_id}' not found")

        # Handle session management for existing chats
        if reply.chat_session_id:
            session_id = f"chat_{reply.chat_session_id}"
        else:
            session_id = await get_or_create_session_for_request_async(request)
        
        session = session_manager.get_session(session_id)

        if reply.chat_session_id:
            await persist_message(
                reply.chat_session_id,
                PersistMessage(
                    type="user",
                    content=reply.user_input,
                    replyTo=ReplyToRef(
                        advisorId=reply.advisor_id,
                        advisorName=chat_orchestrator.get_persona(reply.advisor_id).name,
                        messageId=reply.original_message_id,
                    ),
                ),
            )

        # Find the original message being replied to for context
        original_message = None
        if reply.original_message_id:
            for msg in session.messages:
                if getattr(msg, 'id', None) == reply.original_message_id:
                    original_message = msg.content
                    break
        
        # Create context-aware input
        contextual_input = reply.user_input
        if original_message:
            contextual_input = f"[Replying to your previous message: '{original_message[:100]}...'] {reply.user_input}"
        
        result = await chat_orchestrator.chat_with_persona(
            user_input=contextual_input,
            persona_id=reply.advisor_id,
            session_id=session_id,
            advisor_skill_id=reply.advisor_skill,
        )
        
        # Handle response structure
        if result.get("type") == "single_persona_response" and "persona" in result:
            persona_data = result["persona"]
            if reply.chat_session_id:
                await persist_message(
                    reply.chat_session_id,
                    PersistMessage(
                        type="advisor",
                        persona_id=persona_data["persona_id"],
                        advisorName=persona_data["persona_name"],
                        content=persona_data["response"],
                        isReply=True,
                        advisor_skill=persona_data.get("advisor_skill"),
                        advisor_skill_name=persona_data.get("advisor_skill_name"),
                        replyTo=ReplyToRef(
                            advisorId=reply.advisor_id,
                            advisorName=persona_data["persona_name"],
                            messageId=reply.original_message_id,
                        ),
                    ),
                )
            return {
                "type": "advisor_reply",
                "persona": persona_data["persona_name"],
                "persona_id": persona_data["persona_id"],
                "response": persona_data["response"],
                "original_message_id": reply.original_message_id
            }
        elif "persona_id" in result and "response" in result:
            if reply.chat_session_id:
                await persist_message(
                    reply.chat_session_id,
                    PersistMessage(
                        type="advisor",
                        persona_id=result["persona_id"],
                        advisorName=result["persona_name"],
                        content=result["response"],
                        isReply=True,
                        advisor_skill=result.get("advisor_skill"),
                        advisor_skill_name=result.get("advisor_skill_name"),
                        replyTo=ReplyToRef(
                            advisorId=reply.advisor_id,
                            advisorName=result["persona_name"],
                            messageId=reply.original_message_id,
                        ),
                    ),
                )
            return {
                "type": "advisor_reply",
                "persona": result["persona_name"],
                "persona_id": result["persona_id"],
                "response": result["response"],
                "original_message_id": reply.original_message_id
            }
        else:
            return {
                "type": "error",
                "persona": "System",
                "response": "I'm having trouble generating a reply right now. Please try again."
            }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in reply_to_advisor: {e}")
        error_content = "Sorry, I encountered an error with your reply. Please try again."
        if reply.chat_session_id:
            await persist_message(
                reply.chat_session_id,
                PersistMessage(type="error", content=error_content),
            )
        return {
            "type": "error",
            "persona": "System",
            "response": error_content,
        }

@router.post("/ask/")
async def ask_question(query: PersonaQuery, request: Request):
    """Ask question - UPDATED"""
    try:
        session_id = await get_or_create_session_for_request_async(request)
        
        result = await chat_orchestrator.chat_with_persona(
            user_input=query.question,
            persona_id=query.persona,
            session_id=session_id
        )
        
        if result["type"] == "single_persona_response":
            response_text = result["persona"]["response"]
        else:
            response_text = result.get("message", "I'm having trouble responding right now.")
        
        return {"response": response_text}
        
    except Exception as e:
        logger.error(f"Error in ask endpoint: {str(e)}")
        return {"response": "I encountered an error. Please try again."}
