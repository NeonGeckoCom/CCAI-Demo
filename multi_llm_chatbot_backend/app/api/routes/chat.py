from fastapi import APIRouter, Request, HTTPException, Body, Depends
from app.models.persona import Persona
from app.core.session_manager import get_session_manager
from app.api.utils import get_or_create_session_for_request_async
from app.core.bootstrap import chat_orchestrator
from app.core.auth import get_current_active_user
from app.models.user import User
from pydantic import BaseModel
from typing import Optional
import logging
from app.core.database import get_database
from bson import ObjectId

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
            logger.info(f"Using chat session: {session_id}")
            
            # FIXED: Ensure session exists in memory (load if needed)
            if session_id not in session_manager.sessions:
                logger.warning(f"Chat session {message.chat_session_id} not in memory, loading now")
                
                # FIXED: Pass the user_id parameter to properly load existing session
                loaded_session_id = await get_or_create_session_for_request_async(
                    request, 
                    chat_session_id=message.chat_session_id,
                    user_id=str(current_user.id)
                )
                
                # Use the loaded session ID
                session_id = loaded_session_id
                logger.info(f"Loaded session from database: {session_id}")
        else:
            # No specific chat session, create/use ephemeral session
            session_id = await get_or_create_session_for_request_async(request)
            logger.info(f"Using ephemeral session: {session_id}")

        # Get session from memory
        session = session_manager.get_session(session_id)
        
        # Log session debugging info
        rag_stats = session.get_rag_stats()
        logger.info(f"Session {session_id} has {rag_stats.get('total_documents', 0)} documents available")
        
        # Add user message to session (needed for persona ranking)
        session.append_message("user", message.user_input)
        
        # RESTORED: Get intelligently ordered personas based on context
        top_personas = await chat_orchestrator.get_top_personas(
            session_id=session_id, 
            k=3  # Limit to top 3 most relevant personas
        )
        
        logger.info(f"Intelligent persona order for session {session_id}: {top_personas}")
        
        # Generate responses from ONLY the top personas
        responses = []
        
        for persona_id in top_personas:
            try:
                logger.info(f"Generating response for {persona_id} with session {session_id}")
                
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
                logger.error(f"Error generating response for persona {persona_id}: {str(e)}")
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
        logger.error(f"Error in chat_sequential_enhanced: {e}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
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