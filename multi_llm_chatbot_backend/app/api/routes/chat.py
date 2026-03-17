import asyncio
import json as json_mod
import logging
import traceback
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.api.utils import get_or_create_session_for_request_async
from app.core.auth import get_current_active_user
from app.core.bootstrap import chat_orchestrator
from app.core.database import get_database
from app.core.session_manager import get_session_manager
from app.models.persona import Persona
from app.models.user import User

LOG = logging.getLogger(__name__)

router = APIRouter()
session_manager = get_session_manager()

# Enhanced data models
class UserInput(BaseModel):
    user_input: str

class ChatMessage(BaseModel):
    user_input: str
    session_id: Optional[str] = None
    chat_session_id: Optional[str] = None
    response_length: str = "medium"
    active_advisors: Optional[List[str]] = None
    synthesized: bool = False

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

@router.post("/chat-stream")
async def chat_stream(
    message: ChatMessage,
    request: Request,
    current_user: User = Depends(get_current_active_user),
) -> StreamingResponse:
    """SSE streaming variant of chat-sequential.

    Sends each advisor response as a server-sent event the moment it is ready,
    so the frontend can display advisors incrementally.
    """

    async def _event_generator():
        try:
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

            already = (
                session.messages
                and session.messages[-1].get("role") == "user"
                and session.messages[-1].get("content") == message.user_input
            )
            if not already:
                session.append_message("user", message.user_input)

            if chat_orchestrator._needs_clarification(session, message.user_input):
                clar = await chat_orchestrator.generate_contextual_clarification(message.user_input)
                yield f"event: clarification\ndata: {json_mod.dumps({'message': clar['question'], 'suggestions': clar['suggestions']})}\n\n"
                yield "event: done\ndata: {}\n\n"
                return

            all_ids = list(chat_orchestrator.personas.keys())
            if message.active_advisors:
                all_ids = [pid for pid in all_ids if pid in message.active_advisors]
            k = min(3, len(all_ids))
            top_personas = await chat_orchestrator.get_top_personas(
                session_id=sid, k=k, allowed_ids=all_ids,
            )

            doc_ctx = await chat_orchestrator._retrieve_relevant_documents(
                user_input=message.user_input, session_id=sid, persona_id="",
            )

            is_synthesized = bool(message.synthesized)
            done_queue: asyncio.Queue = asyncio.Queue()

            async def _run(pid: str) -> None:
                persona = chat_orchestrator.get_persona(pid)
                if not persona:
                    return
                result = await chat_orchestrator._generate_single_persona_response(
                    session, persona,
                    message.response_length or "medium",
                    prefetched_document_context=doc_ctx,
                )
                session.append_message(pid, result["response"])
                await done_queue.put(result)

            tasks = [asyncio.create_task(_run(pid)) for pid in top_personas]

            collected = []
            for _ in range(len(tasks)):
                result = await done_queue.get()
                evt = {
                    "persona_id": result["persona_id"],
                    "persona_name": result["persona_name"],
                    "content": result["response"],
                    "used_documents": result.get("used_documents", False),
                    "document_chunks_used": result.get("document_chunks_used", 0),
                }
                collected.append(evt)

                if is_synthesized:
                    yield f"event: progress\ndata: {json_mod.dumps({'persona_id': evt['persona_id'], 'persona_name': evt['persona_name']})}\n\n"
                else:
                    yield f"event: advisor\ndata: {json_mod.dumps(evt)}\n\n"

            await asyncio.gather(*tasks, return_exceptions=True)

            if is_synthesized and len(collected) > 1:
                synth = await chat_orchestrator.synthesize_responses(collected)
                yield f"event: synthesized\ndata: {json_mod.dumps(synth)}\n\n"

            yield "event: done\ndata: {}\n\n"

        except Exception as exc:
            LOG.error(f"chat-stream error: {exc}")
            LOG.error(traceback.format_exc())
            yield f"event: error\ndata: {json_mod.dumps({'detail': str(exc)})}\n\n"

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
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
        LOG.info(f"Switching to chat session: {request.chat_session_id}")
        
        # Load the chat session into memory context with consistent session ID
        memory_session_id = await get_or_create_session_for_request_async(
            req, 
            chat_session_id=request.chat_session_id,
            user_id=str(current_user.id)
        )
        
        if not memory_session_id:
            raise HTTPException(status_code=404, detail="Chat session not found")
        
        LOG.info(f"Loaded chat into memory session: {memory_session_id}")
        
        # Get the loaded session
        session = session_manager.get_session(memory_session_id)
        
        # Verify document access after loading
        rag_stats = session.get_rag_stats()
        LOG.info(f"After switch - Session {memory_session_id} has {rag_stats.get('total_documents', 0)} documents")
        
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
        
        LOG.info(f"Switch successful - {len(original_messages)} messages, {rag_stats.get('total_documents', 0)} documents")
        
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
        LOG.error(f"Error switching to chat {request.chat_session_id}: {e}")
        import traceback
        LOG.error(f"Full traceback: {traceback.format_exc()}")
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
        LOG.error(f"Error creating new chat: {e}")
        raise HTTPException(status_code=500, detail="Failed to create new chat")

@router.post("/chat-sequential")
async def chat_sequential_enhanced(
    message: ChatMessage, 
    request: Request,
    current_user: User = Depends(get_current_active_user)
):
    """
    Enhanced sequential chat with proper session management, document access, and intelligent persona ordering
    """
    try:
        # Ensure consistent session ID for document retrieval
        if message.chat_session_id:
            # Use the memory session format that matches document storage
            session_id = f"chat_{message.chat_session_id}"
            LOG.info(f"Using chat session: {session_id}")
            
            # FIXED: Ensure session exists in memory (load if needed)
            if session_id not in session_manager.sessions:
                LOG.warning(f"Chat session {message.chat_session_id} not in memory, loading now")
                
                # FIXED: Pass the user_id parameter to properly load existing session
                loaded_session_id = await get_or_create_session_for_request_async(
                    request, 
                    chat_session_id=message.chat_session_id,
                    user_id=str(current_user.id)
                )
                
                # Use the loaded session ID
                session_id = loaded_session_id
                LOG.info(f"Loaded session from database: {session_id}")
        else:
            # No specific chat session, create/use ephemeral session
            session_id = await get_or_create_session_for_request_async(request)
            LOG.info(f"Using ephemeral session: {session_id}")

        # Get session from memory
        session = session_manager.get_session(session_id)
        
        # Log session debugging info
        rag_stats = session.get_rag_stats()
        LOG.info(f"Session {session_id} has {rag_stats.get('total_documents', 0)} documents available")
        
        # Warn if a repeated input message is received
        if (
            session.messages and
            session.messages[-1].get('role') == 'user' and
            session.messages[-1].get('content') == message.user_input
            ):
            # TODO: This should be handled in the front-end input
            LOG.warning(f"Repeated user input: {message.user_input}")
        session.append_message("user", message.user_input)
        
        # Check if the user's message is vague and needs clarification
        if chat_orchestrator._needs_clarification(session, message.user_input):
            clarification = await chat_orchestrator.generate_contextual_clarification(
                message.user_input
            )
            LOG.info(f"Clarification triggered for input: {message.user_input!r}")
            return {
                "status": "clarification_needed",
                "message": clarification["question"],
                "suggestions": clarification["suggestions"],
                "session_debug": {
                    "session_id": session_id,
                    "trigger": "vague_input"
                }
            }
        
        # RESTORED: Get intelligently ordered personas based on context
        top_personas = await chat_orchestrator.get_top_personas(
            session_id=session_id, 
            k=3  # Limit to top 3 most relevant personas
        )
        
        LOG.info(f"Intelligent persona order for session {session_id}: {top_personas}")
        
        # Generate responses from ONLY the top personas
        responses = []
        
        for persona_id in top_personas:
            try:
                LOG.info(f"Generating response for {persona_id} with session {session_id}")
                
                # Generate response from this specific persona
                persona_result = await chat_orchestrator.chat_with_persona(
                    user_input=message.user_input,
                    persona_id=persona_id,
                    session_id=session_id,  # This ensures document access
                    response_length=message.response_length or "medium"
                )
                
                # FIXED: Safe response processing with proper error handling
                if isinstance(persona_result, dict):
                    # Handle different response formats
                    if "persona_name" in persona_result and "response" in persona_result:
                        responses.append({
                            "persona_id": persona_result["persona_id"],
                            "persona_name": persona_result["persona_name"], 
                            "content": persona_result["response"],
                            "used_documents": persona_result.get("used_documents", False),
                            "document_chunks_used": persona_result.get("document_chunks_used", 0)
                        })
                    elif persona_result.get("type") == "single_persona_response" and "persona" in persona_result:
                        persona_data = persona_result["persona"]
                        responses.append({
                            "persona_id": persona_data["persona_id"],
                            "persona_name": persona_data["persona_name"],
                            "content": persona_data["response"],
                            "used_documents": persona_data.get("used_documents", False),
                            "document_chunks_used": persona_data.get("document_chunks_used", 0)
                        })
                    elif "error" in persona_result:
                        # Handle error responses
                        responses.append({
                            "persona_id": persona_id,
                            "persona_name": chat_orchestrator.personas[persona_id].name,
                            "content": persona_result["response"],
                            "used_documents": False,
                            "document_chunks_used": 0
                        })
                    else:
                        # Generic dict response
                        content = persona_result.get("response") or persona_result.get("content", "")
                        if content.strip():
                            responses.append({
                                "persona_id": persona_id,
                                "persona_name": chat_orchestrator.personas[persona_id].name,
                                "content": content,
                                "used_documents": persona_result.get("used_documents", False),
                                "document_chunks_used": persona_result.get("document_chunks_used", 0)
                            })
                else:
                    # Fallback for non-dict responses
                    responses.append({
                        "persona_id": persona_id,
                        "persona_name": chat_orchestrator.personas[persona_id].name,
                        "content": "I'm having trouble processing your question right now. Please try again.",
                        "used_documents": False,
                        "document_chunks_used": 0
                    })
                    
            except Exception as e:
                LOG.error(f"Error generating response for persona {persona_id}: {str(e)}")
                responses.append({
                    "persona_id": persona_id,
                    "persona_name": chat_orchestrator.personas[persona_id].name,
                    "content": "I encountered an error while processing your question. Please try again.",
                    "used_documents": False,
                    "document_chunks_used": 0
                })
        
        return {
            "responses": responses,
            "session_debug": {
                "session_id": session_id,
                "documents_available": rag_stats.get('total_documents', 0),
                "chunks_available": rag_stats.get('total_chunks', 0),
                "valid_responses": len(responses),
                "selected_personas": top_personas,
                "total_personas_available": len(chat_orchestrator.personas)
            }
        }
        
    except Exception as e:
        LOG.error(f"Error in chat_sequential_enhanced: {e}")
        import traceback
        LOG.error(f"Full traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Chat processing failed: {str(e)}")


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
        LOG.error(f"Error in chat_with_specific_advisor: {e}")
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
        LOG.error(f"Error in reply_to_advisor: {e}")
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
        LOG.error(f"Error in ask endpoint: {str(e)}")
        return {"response": "I encountered an error. Please try again."}
