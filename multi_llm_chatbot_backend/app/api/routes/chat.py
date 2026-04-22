import asyncio
import json
import logging
import traceback
from typing import Any, Dict, List, Literal, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.routes.chat_sessions import persist_message
from app.api.utils import get_or_create_session_for_request_async
from app.core.auth import get_current_active_user
from app.core.bootstrap import chat_orchestrator
from app.core.database import get_database
from app.core.session_manager import get_session_manager
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()
session_manager = get_session_manager()

# Enhanced data models
class UserInput(BaseModel):
    user_input: str

class ChatMessage(BaseModel):
    user_input: str
    session_id: Optional[str] = None
    chat_session_id: Optional[str] = None  # MongoDB chat session ID
    response_length: str = "medium"
    active_advisors: Optional[List[str]] = None

class ReplyToAdvisor(BaseModel):
    user_input: str
    advisor_id: str
    original_message_id: str = None
    chat_session_id: Optional[str] = None

class PersonaQuery(BaseModel):
    question: str
    persona: str

class SwitchChatRequest(BaseModel):
    chat_session_id: str

class NewChatRequest(BaseModel):
    title: Optional[str] = "New Chat"

ChatStreamEventType = Literal["error", "progress", "clarification", "advisor"]


class ChatStreamLine(BaseModel):
    """One NDJSON line from ``/chat-stream``."""

    type: ChatStreamEventType
    data: Dict[str, Any] = Field(default_factory=dict)

    def to_ndjson(self) -> str:
        return json.dumps(self.model_dump(mode="json"), ensure_ascii=False) + "\n"


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

            # Append user message to in-memory session and persist to MongoDB
            session.append_message("user", message.user_input)
            if message.chat_session_id:
                await persist_message(message.chat_session_id, {
                    "id": str(ObjectId()),
                    "type": "user",
                    "content": message.user_input,
                })

            if chat_orchestrator.needs_clarification(session, message.user_input):
                clar = await chat_orchestrator.generate_contextual_clarification(message.user_input)
                yield ChatStreamLine(
                    type="clarification",
                    data={
                        "message": clar["question"],
                        "suggestions": clar["suggestions"],
                    },
                ).to_ndjson()
                yield ChatStreamLine(
                    type="progress",
                    data={"phase": "complete"},
                ).to_ndjson()
                return

            # If an enabled tool can handle this query, return its response
            # directly and skip persona generation.
            tool_result = await chat_orchestrator.get_tool_response(message.user_input)
            if tool_result.used_tool:
                session.append_message("orchestrator", tool_result.text)
                yield ChatStreamLine(
                    type="advisor",
                    data={
                        "persona_id": "orchestrator",
                        "persona_name": "Orchestrator",
                        "content": tool_result.text,
                        "used_documents": False,
                        "document_chunks_used": 0,
                    },
                ).to_ndjson()
                yield ChatStreamLine(
                    type="progress",
                    data={"phase": "complete"},
                ).to_ndjson()
                return

            # Get personas most relevant to the current session
            top_personas = await chat_orchestrator.get_top_personas(
                session_id=sid,
            )

            done_queue: asyncio.Queue = asyncio.Queue()

            async def _run(pid: str) -> None:
                try:
                    persona = chat_orchestrator.get_persona(pid)
                    result = await chat_orchestrator.generate_single_persona_response(
                        session, persona,
                        message.response_length or "medium",
                    )
                    session.append_message(pid, result["response"])
                    await done_queue.put(result)
                except Exception as e:
                    logger.exception(f"chat-stream _run failed for {pid}: {e}")
                    await done_queue.put({
                        "persona_id": persona.id,
                        "persona_name": persona.name,
                        "response": f"I ran into a technical issue. Please try again. ({e!s})",
                        "used_documents": False,
                        "document_chunks_used": 0,
                    })

            tasks = [asyncio.create_task(_run(pid)) for pid in top_personas]

            for _ in range(len(tasks)):
                result = await done_queue.get()
                line = ChatStreamLine(
                    type="advisor",
                    data={
                        "persona_id": result["persona_id"],
                        "persona_name": result["persona_name"],
                        "content": result["response"],
                        "used_documents": result.get("used_documents", False),
                        "document_chunks_used": result.get("document_chunks_used", 0),
                    },
                )
                yield line.to_ndjson()

            await asyncio.gather(*tasks, return_exceptions=True)

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
        
        result = await chat_orchestrator.chat_with_persona(
            user_input=input.user_input,
            persona_id=persona_id,
            session_id=session_id
        )
        
        # Handle response structure
        if result.get("type") == "single_persona_response" and "persona" in result:
            persona_data = result["persona"]
            return {
                "persona": persona_data["persona_name"],
                "persona_id": persona_data["persona_id"],
                "response": persona_data["response"]
            }
        elif "persona_id" in result and "response" in result:
            return {
                "persona": result["persona_name"],
                "persona_id": result["persona_id"],
                "response": result["response"]
            }
        else:
            return {
                "persona": "System",
                "response": "I'm having trouble generating a response right now. Please try again."
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in chat_with_specific_advisor: {e}")
        return {
            "persona": "System",
            "response": "I'm having trouble generating a response right now. Please try again."
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
            session_id=session_id
        )
        
        # Handle response structure
        if result.get("type") == "single_persona_response" and "persona" in result:
            persona_data = result["persona"]
            return {
                "type": "advisor_reply",
                "persona": persona_data["persona_name"],
                "persona_id": persona_data["persona_id"],
                "response": persona_data["response"],
                "original_message_id": reply.original_message_id
            }
        elif "persona_id" in result and "response" in result:
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
        return {
            "type": "error",
            "persona": "System",
            "response": "I'm having trouble generating a reply right now. Please try again."
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
