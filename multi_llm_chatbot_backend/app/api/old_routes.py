import os
from fastapi import APIRouter, Body, HTTPException, Header, UploadFile, File, Request
from fastapi import Query
from typing import Optional, List
import httpx
from app.llm.llm_client import LLMClient
from app.llm.improved_gemini_client import ImprovedGeminiClient
from app.llm.improved_ollama_client import ImprovedOllamaClient
from app.models.persona import Persona
from app.core.improved_orchestrator import ImprovedChatOrchestrator
from app.core.session_manager import get_session_manager
from app.core.rag_manager import get_rag_manager
from app.models.default_personas import get_default_personas
from app.utils.document_extractor import extract_text_from_file
from app.utils.file_limits import is_within_upload_limit
from pydantic import BaseModel

from fastapi.responses import StreamingResponse
from fastapi import Query
from app.utils.file_export import export_chat_as_file

from app.utils.chat_summary import generate_summary_from_messages, parse_summary_to_blocks
from app.utils.file_export import prepare_export_response, generate_pdf_file_from_blocks
from app.version import __version__

import hashlib
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

# Provider management (same as before)
current_provider = "gemini"
available_providers = ["ollama", "gemini"]

def create_llm_client(provider: str = None) -> LLMClient:
    """Create LLM client based on provider"""
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
    else:
        raise ValueError(f"Unknown provider: {provider}")

# Initialize with default provider
llm = create_llm_client()
chat_orchestrator = ImprovedChatOrchestrator()
session_manager = get_session_manager()

# Initialize personas
DEFAULT_PERSONAS = get_default_personas(llm)
for persona in DEFAULT_PERSONAS:
    chat_orchestrator.register_persona(persona)

# Keep all the same data models as before
class UserInput(BaseModel):
    user_input: str

class PersonaInput(BaseModel):
    id: str
    name: str
    system_prompt: str

class ChatMessage(BaseModel):
    user_input: str
    session_id: Optional[str] = None
    response_length: Optional[str] = "medium"

class ReplyToAdvisor(BaseModel):
    user_input: str
    advisor_id: str
    original_message_id: Optional[str] = None

class ProviderSwitch(BaseModel):
    provider: str

# ==============================================================
# SESSION MANAGEMENT COMPATIBILITY LAYER
# ==============================================================

def get_or_create_session_for_request(request: Request, 
                                    session_id_override: Optional[str] = None) -> str:
    """
    Get or create session for request using multiple strategies:
    1. Use provided session_id if given
    2. Use X-Session-ID header if present  
    3. Use client IP as fallback for backward compatibility
    4. Create new session if nothing available
    
    This allows the old stateless API to work with session management
    """
    # Strategy 1: Explicit session ID (for new clients)
    if session_id_override:
        return session_id_override
    
    # Strategy 2: Check for session header (optional for frontend)
    session_header = request.headers.get("X-Session-ID")
    if session_header:
        return session_header
    
    # Strategy 3: Use client IP for backward compatibility
    # This gives each client IP their own persistent session
    client_ip = request.client.host if request.client else "unknown"
    ip_session_id = f"ip_{client_ip}"
    
    # Get or create session for this IP
    session = session_manager.get_session(ip_session_id)
    return session.session_id



# Helper functions (same as before)
def _is_valid_response(response: str, persona_id: str) -> bool:
    """Validate response quality"""
    if len(response) < 2 or len(response) > 5000:
        return False
    
    confusion_indicators = [
        f"Thank you, Dr. {persona_id.title()}",
        "Assistant:",
        f"Dr. {persona_id.title()}",
        "Assistant:",
        f"Dr. {persona_id.title()} Advisor:",
        "excellent discussion, Assistant"
    ]
    
    return not any(indicator in response for indicator in confusion_indicators)

def _get_persona_fallback(persona_id: str) -> str:
    """Get persona-specific fallback responses"""
    fallbacks = {
        "methodologist": "Focus on ensuring your methodology aligns with your research question. What specific method are you considering?",
        "theorist": "Consider the theoretical framework underlying your approach. What assumptions guide your thinking?",
        "pragmatist": "Let's break this down into actionable steps. What's the most important thing you need to decide today?"
    }
    return fallbacks.get(persona_id, "I'd be happy to help. Could you provide more details?")

# Provider management endpoints (EXACTLY THE SAME)
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
        raise HTTPException(
            status_code=400, 
            detail=f"Unknown provider: {provider_data.provider}. Available: {available_providers}"
        )
    
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
        raise HTTPException(
            status_code=500,
            detail=f"Failed to switch to {provider_data.provider}: {str(e)}"
        )

# Main chat endpoint
@router.post("/chat-sequential")
async def chat_sequential_enhanced(message: ChatMessage, request: Request):
    """
    Enhanced sequential chat with intelligent persona ordering.
    Returns responses in the order determined by LLM-based relevance ranking.
    """
    try:
        # Get or create session
        session_id = get_or_create_session_for_request(request, message.session_id)
        
        # Add user message to session first (needed for persona ranking)
        session = session_manager.get_session(session_id)
        session.append_message("user", message.user_input)
        
        # Get intelligently ordered personas based on context
        top_personas = await chat_orchestrator.get_top_personas(
            session_id=session_id, 
            k=3  # Get top 3 most relevant personas
        )
        
        logger.info(f"Intelligent persona order for session {session_id}: {top_personas}")
        
        # Generate responses from personas in the intelligent order
        responses = []
        
        for persona_id in top_personas:
            try:
                # Generate response from this persona
                persona_result = await chat_orchestrator.chat_with_persona(
                    user_input=message.user_input,
                    persona_id=persona_id,
                    session_id=session_id,
                    response_length=message.response_length or "medium"
                )
                
                
                if "persona_name" in persona_result and "response" in persona_result:
                    responses.append({
                        "persona": persona_result["persona_name"],
                        "persona_id": persona_result["persona_id"],
                        "response": persona_result["response"]
                    })
                elif persona_result.get("type") == "single_persona_response" and "persona" in persona_result:
                    persona_data = persona_result["persona"]
                    responses.append({
                        "persona": persona_data["persona_name"],
                        "persona_id": persona_data["persona_id"],
                        "response": persona_data["response"]
                    })
                else:
                    # Fallback response
                    responses.append({
                        "persona": chat_orchestrator.personas[persona_id].name,
                        "persona_id": persona_id,
                        "response": "I'm having trouble processing your question right now. Please try again."
                    })
                    
            except Exception as e:
                logger.error(f"Error generating response for persona {persona_id}: {str(e)}")
                # Error fallback
                responses.append({
                    "persona": chat_orchestrator.personas[persona_id].name,
                    "persona_id": persona_id,
                    "response": "I encountered an error while processing your question. Please try again."
                })
        
        #  response format
        return {
            "type": "sequential_responses",
            "responses": responses
        }

    except Exception as e:
        logger.error(f"Error in enhanced sequential chat: {str(e)}")
        return {
            "type": "error", 
            "responses": [{
                "persona": "System",
                "response": "I'm having trouble processing your request. Could you please try again?"
            }]
        }

@router.post("/chat/{persona_id}")
async def chat_with_specific_advisor(persona_id: str, input: UserInput, request: Request):
    """Chat with a specific advisor - SAME INTERFACE"""
    try:
        if persona_id not in chat_orchestrator.personas:
            raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' not found")

        # Get session using compatibility layer
        session_id = get_or_create_session_for_request(request)
        
        # Use new orchestrator
        result = await chat_orchestrator.chat_with_persona(
            user_input=input.user_input,
            persona_id=persona_id,
            session_id=session_id
        )
        
        # FIX: Handle the actual response structure from orchestrator
        if result.get("type") == "single_persona_response" and "persona" in result:
            # New expected structure
            persona_data = result["persona"]
            return {
                "persona": persona_data["persona_name"],
                "persona_id": persona_data["persona_id"],
                "response": persona_data["response"]
            }
        elif "persona_id" in result and "response" in result:
            # Current actual structure from orchestrator
            return {
                "persona": result["persona_name"],
                "persona_id": result["persona_id"],
                "response": result["response"]
            }
        elif result.get("type") == "error" or "error" in result:
            # Error handling
            return {
                "persona": "System",
                "response": result.get("error", "I'm having trouble generating a response right now. Please try again.")
            }
        else:
            # Fallback
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

# Reply to advisor endpoint (SAME INTERFACE)
@router.post("/reply-to-advisor")
async def reply_to_advisor(reply: ReplyToAdvisor, request: Request):
    """Reply to a specific advisor - SAME INTERFACE"""
    try:
        if reply.advisor_id not in chat_orchestrator.personas:
            raise HTTPException(status_code=404, detail=f"Advisor '{reply.advisor_id}' not found")

        # Get session using compatibility layer
        session_id = get_or_create_session_for_request(request)
        
        # Use new orchestrator
        result = await chat_orchestrator.chat_with_persona(
            user_input=reply.user_input,
            persona_id=reply.advisor_id,
            session_id=session_id
        )
        
        if result["type"] == "single_persona_response":
            persona_data = result["persona"]
            return {
                "type": "advisor_reply",
                "persona": persona_data["persona_name"],
                "persona_id": persona_data["persona_id"],
                "response": persona_data["response"],
                "original_message_id": reply.original_message_id
            }
        else:
            return {
                "type": "error",
                "persona": "System",
                "response": result.get("message", "I'm having trouble generating a reply right now. Please try again.")
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

@router.post("/upload-document")
async def upload_document(file: UploadFile = File(...), request: Request = None):
    """
    Enhanced document upload with better metadata tracking and user feedback
    """
    try:
        # Get or create session
        session_id = get_or_create_session_for_request(request)
        session = session_manager.get_session(session_id)
        
        # Validate file
        MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
        if file.size and file.size > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail="File size exceeds 10MB limit")

        
        # Read and validate file content
        file_bytes = await file.read()
        content = extract_text_from_file(file_bytes, file.content_type)
        if not content.strip():
            raise HTTPException(status_code=400, detail="Document is empty or unreadable.")

        # Get enhanced RAG manager
        rag_manager = get_rag_manager()
        
        # Determine file type for metadata
        file_type_map = {
            "application/pdf": "pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", 
            "text/plain": "txt"
        }
        file_type = file_type_map.get(file.content_type, "unknown")
        
        # Add document to enhanced vector database
        rag_result = rag_manager.add_document(
            content=content,
            filename=file.filename,
            session_id=session_id,
            file_type=file_type
        )
        
        if not rag_result["success"]:
            raise HTTPException(
                status_code=500, 
                detail=f"Failed to process document: {rag_result.get('error', 'Unknown error')}"
            )
        
        # Update session tracking
        session.uploaded_files.append(file.filename)
        session.total_upload_size += len(file_bytes)
        
        # Add enhanced document reference to session messages
        doc_metadata = rag_result.get("document_metadata", {})
        doc_title = doc_metadata.get("title", file.filename)
        
        session.append_message(
            "system", 
            f"Document uploaded: '{doc_title}' ({file.filename}) - "
            f"{rag_result['chunks_created']} sections processed, "
            f"~{rag_result['total_tokens']} tokens analyzed. "
            f"You can now ask questions about this document by referencing it by name."
        )

        return {
            "message": f"Document '{file.filename}' uploaded and processed successfully.",
            "filename": file.filename,
            "document_title": doc_title,
            "chunks_created": rag_result['chunks_created'],
            "total_tokens": rag_result['total_tokens'],
            "file_type": file_type,
            "can_reference_by_name": True,
            "suggestions": [
                f"Try asking: 'What methodology does my {file.filename} propose?'",
                f"Or: 'What are the key findings in {doc_title}?'",
                f"Or: 'Compare the approach in my document with current best practices'"
            ]
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing document upload: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing document: {str(e)}")

    
@router.get("/export-chat")
async def export_chat(request: Request, format: str = Query(..., regex="^(txt|pdf|docx)$")):
    """
    Export the current chat context in the requested format.
    """
    try:
        session_id = get_or_create_session_for_request(request)
        session = session_manager.get_session(session_id)

        if not session.messages:
            return {"error": "No messages in this session."}

        return prepare_export_response(session.messages, format)

    except Exception as e:
        logger.error(f"Error exporting chat: {str(e)}")
        return {"error": "Failed to export chat.", "detail": str(e)}
    
    
@router.get("/chat-summary")
async def chat_summary(
    request: Request,
    format: str = Query("text", regex="^(txt|pdf|docx)$")
):
    """
    Generate and return a summary of the current session chat.
    Can return as plain txt, PDF, or DOCX.
    """
    try:
        session_id = get_or_create_session_for_request(request)
        session = session_manager.get_session(session_id)

        if not session.messages:
            return {"error": "No messages in this session."}

        llm = next(iter(chat_orchestrator.personas.values())).llm
        summary_text = await generate_summary_from_messages(session.messages, llm)

        if format == "txt":
            return prepare_export_response(summary_text, "txt", filename_prefix="chat_summary")

        elif format == "docx":
            return prepare_export_response(summary_text, "docx", filename_prefix="chat_summary")

        elif format == "pdf":
            # Parse and render using block formatting
            blocks = [{"type": "heading", "text": "Chat Summary"}] + parse_summary_to_blocks(summary_text)

            file_stream = generate_pdf_file_from_blocks(blocks)
            return StreamingResponse(
                file_stream,
                media_type="application/pdf",
                headers={"Content-Disposition": "attachment; filename=chat_summary.pdf"}
            )

    except Exception as e:
        logger.error(f"Error in chat-summary endpoint: {str(e)}")
        return {"error": "Summary generation failed", "detail": str(e)}




# Add new endpoint to get document statistics
@router.get("/document-stats")
async def get_document_stats(request: Request):
    """Get statistics about uploaded documents in vector database"""
    try:
        session_id = get_or_create_session_for_request(request)
        rag_manager = get_rag_manager()
        
        stats = rag_manager.get_document_stats(session_id)
        return stats
        
    except Exception as e:
        logger.error(f"Error getting document stats: {str(e)}")
        return {"total_chunks": 0, "total_documents": 0, "documents": []}

# Get uploaded files (SAME INTERFACE)
@router.get("/uploaded-files")
async def get_uploaded_filenames(request: Request):
    """Get uploaded files - SAME INTERFACE"""
    try:
        session_id = get_or_create_session_for_request(request)
        session = session_manager.get_session(session_id)
        return {"files": session.uploaded_files}
    except Exception as e:
        logger.error(f"Error getting uploaded files: {str(e)}")
        return {"files": []}

# Context endpoint (SAME INTERFACE)
@router.get("/context")
async def get_context(request: Request):
    """Get context - ENHANCED with RAG information"""
    try:
        session_id = get_or_create_session_for_request(request)
        session = session_manager.get_session(session_id)

        # Get RAG statistics
        rag_stats = session.get_rag_stats()
        
        return {
            "messages": session.messages,
            "rag_info": {
                "total_documents": rag_stats.get("total_documents", 0),
                "total_chunks": rag_stats.get("total_chunks", 0),
                "documents": rag_stats.get("documents", [])
            }
        }
    except Exception as e:
        logger.error(f"Error getting context: {str(e)}")
        return {"messages": [], "rag_info": {"total_documents": 0, "total_chunks": 0}}

@router.post("/reset-session")
async def reset_session(request: Request):
    """Reset session - ENHANCED with RAG cleanup"""
    try:
        session_id = get_or_create_session_for_request(request)
        
        # Use the enhanced reset that clears both conversation and vector DB
        success = session_manager.reset_session_completely(session_id)
        
        if success:
            return {"status": "reset", "message": "Session and all documents reset successfully"}
        else:
            return {"status": "error", "message": "Failed to reset session"}
    except Exception as e:
        logger.error(f"Error resetting session: {e}")
        return {"status": "error", "message": "Failed to reset session"}


# Legacy model endpoints (SAME INTERFACE)
@router.post("/switch-model")
async def switch_model(model_name: str = Body(...)):
    """Legacy model switching - SAME INTERFACE"""
    if "gemini" in model_name.lower():
        return await switch_provider(ProviderSwitch(provider="gemini"))
    else:
        return await switch_provider(ProviderSwitch(provider="ollama"))

@router.get("/current-model")
async def get_current_model():
    """Legacy model info - SAME INTERFACE"""
    model_name = llm.model_name if hasattr(llm, 'model_name') else "gemini-2.0-flash"
    return {
        "model": model_name,
        "provider": current_provider
    }

@router.post("/search-documents")
async def search_documents(request: Request, query: str = Body(..., embed=True), persona: str = Body("", embed=True)):
    """
    Search uploaded documents using RAG
    
    This endpoint allows direct document search for debugging/testing
    """
    try:
        session_id = get_or_create_session_for_request(request)
        rag_manager = get_rag_manager()
        
        # Get persona context for search enhancement
        persona_contexts = {
            "methodologist": "methodology research design analysis",
            "theorist": "theory theoretical framework conceptual",
            "pragmatist": "practical application implementation"
        }
        persona_context = persona_contexts.get(persona, "")
        
        # Search documents
        results = rag_manager.search_documents(
            query=query,
            session_id=session_id,
            persona_context=persona_context,
            n_results=5
        )
        
        return {
            "query": query,
            "persona_filter": persona,
            "results_count": len(results),
            "results": results
        }
        
    except Exception as e:
        logger.error(f"Error searching documents: {str(e)}")
        return {"query": query, "results_count": 0, "results": [], "error": str(e)}

@router.get("/session-stats")
async def get_session_stats(request: Request):
    """Get comprehensive session statistics including RAG data"""
    try:
        session_id = get_or_create_session_for_request(request)
        stats = session_manager.get_session_stats(session_id)
        return stats
    except Exception as e:
        logger.error(f"Error getting session stats: {str(e)}")
        return {"error": str(e)}


@router.get("/debug/personas")
async def debug_personas(request: Request):
    """Debug personas - ENHANCED with RAG information"""
    try:
        session_id = get_or_create_session_for_request(request)
        session = session_manager.get_session(session_id)
        
        # Get RAG statistics
        rag_manager = get_rag_manager()
        rag_stats = rag_manager.get_document_stats(session_id)
        
        return {
            "personas": {
                pid: {
                    "name": persona.name,
                    "prompt": persona.system_prompt[:100] + "...",
                    "retrieval_keywords": chat_orchestrator._get_persona_context_keywords(pid)
                } for pid, persona in chat_orchestrator.personas.items()
            },
            "session_info": {
                "context_length": len(session.messages),
                "uploaded_files": session.uploaded_files,
                "rag_stats": rag_stats
            },
            "current_provider": current_provider,
            "rag_enabled": True
        }
    except Exception as e:
        logger.error(f"Error in debug endpoint: {str(e)}")
        return {
            "personas": {},
            "session_info": {"context_length": 0},
            "current_provider": current_provider,
            "rag_enabled": False,
            "error": str(e)
        }

@router.get("/debug/ranked-personas")
async def get_ranked_personas(request: Request, k: int = Query(3, ge=1, le=10)):
    """
    Debug endpoint: Get top-k ranked personas based on current session context.
    Uses LLM to rank based on latest conversation messages.
    """
    try:
        session_id = get_or_create_session_for_request(request)
        
        # Call the ranking method
        top_personas = await chat_orchestrator.get_top_personas(session_id=session_id, k=k)
        
        # Include some metadata for debug purposes
        return {
            "ranked_personas": top_personas,
            "available_personas": list(chat_orchestrator.personas.keys()),
            "session_id": session_id
        }
    except Exception as e:
        logger.error(f"Error in /debug/ranked-personas: {e}")
        return {
            "ranked_personas": [],
            "error": str(e)
        }


@router.post("/chat/{persona_id}")
async def chat_with_specific_persona(persona_id: str, message: ChatMessage, request: Request):
    """
    Chat with a specific persona - Enhanced with RAG debugging
    
    This endpoint helps debug RAG integration by testing individual personas
    """
    try:
        session_id = get_or_create_session_for_request(request, message.session_id)
        
        # Validate persona exists
        if persona_id not in chat_orchestrator.personas:
            available_personas = list(chat_orchestrator.personas.keys())
            raise HTTPException(
                status_code=400, 
                detail=f"Persona '{persona_id}' not found. Available: {available_personas}"
            )
        
        # Use the enhanced orchestrator method
        result = await chat_orchestrator.chat_with_persona(
            user_input=message.user_input,
            persona_id=persona_id,
            session_id=session_id,
            response_length=message.response_length or "medium"
        )
        
        # Fix: Handle the response structure properly
        if result.get("type") == "single_persona_response" and "persona" in result:
            persona_data = result["persona"]
            
            # Add debugging information
            result["debug_info"] = {
                "persona_id": persona_id,
                "session_id": session_id,
                "query_length": len(message.user_input),
                "rag_manager_available": True,
                "used_documents": persona_data.get("used_documents", False),
                "chunks_used": persona_data.get("document_chunks_used", 0)
            }
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in individual persona chat: {str(e)}")
        return {
            "type": "error",
            "message": f"Error chatting with {persona_id}: {str(e)}",
            "persona_id": persona_id
        }
    
@router.get("/debug/enhanced-personas")
async def debug_enhanced_personas(request: Request):
    """
    Enhanced debug endpoint with document context information
    """
    try:
        session_id = get_or_create_session_for_request(request)
        session = session_manager.get_session(session_id)
        
        # Get enhanced RAG statistics
        rag_manager = get_rag_manager()
        rag_stats = rag_manager.get_document_stats(session_id)
        
        # Analyze document awareness capabilities
        document_analysis = {}
        if rag_stats.get("documents"):
            for doc in rag_stats["documents"]:
                document_analysis[doc["filename"]] = {
                    "chunks_available": doc["chunks"],
                    "estimated_tokens": doc["estimated_tokens"],
                    "sections_identified": doc["sections"],
                    "content_types_detected": {
                        "has_methodology": doc.get("has_methodology", False),
                        "has_theory": doc.get("has_theory", False),
                        "has_references": doc.get("has_references", False)
                    }
                }
        
        return {
            "personas": {
                pid: {
                    "name": persona.name,
                    "expertise_area": persona.name.split(" - ")[1] if " - " in persona.name else "General",
                    "prompt_quality": "enhanced" if len(persona.system_prompt) > 500 else "basic",
                    "document_handling_enabled": "document awareness" in persona.system_prompt.lower(),
                    "retrieval_keywords": chat_orchestrator._get_enhanced_persona_context_keywords(pid)[:100] + "...",
                    "temperature": getattr(persona, 'temperature', 5)
                } for pid, persona in chat_orchestrator.personas.items()
            },
            "session_info": {
                "context_length": len(session.messages),
                "uploaded_files": session.uploaded_files,
                "rag_stats": rag_stats,
                "document_analysis": document_analysis
            },
            "system_capabilities": {
                "document_name_recognition": True,
                "cross_document_analysis": True,
                "persona_specialized_retrieval": True,
                "enhanced_attribution": True,
                "query_document_detection": True
            },
            "current_provider": current_provider,
            "rag_enabled": True,
            "enhancement_level": "advanced"
        }
    except Exception as e:
        logger.error(f"Error in enhanced debug endpoint: {str(e)}")
        return {
            "error": str(e),
            "enhancement_level": "error",
            "rag_enabled": False
        }

@router.get("/document-insights/{filename}")
async def get_document_insights(filename: str, request: Request):
    """
    NEW ENDPOINT: Get insights about a specific uploaded document
    """
    try:
        session_id = get_or_create_session_for_request(request)
        rag_manager = get_rag_manager()
        
        # Get document statistics
        stats = rag_manager.get_document_stats(session_id)
        
        # Find the specific document
        document_info = None
        for doc in stats.get("documents", []):
            if doc["filename"] == filename:
                document_info = doc
                break
        
        if not document_info:
            raise HTTPException(status_code=404, detail=f"Document {filename} not found")
        
        # Get a sample of content from this document
        results = rag_manager.collection.get(
            where={"session_id": session_id, "filename": filename},
            limit=3,
            include=["documents", "metadatas"]
        )
        
        sample_sections = []
        if results["documents"]:
            for doc, metadata in zip(results["documents"], results["metadatas"]):
                sample_sections.append({
                    "section": metadata.get("document_section", "unknown"),
                    "content_preview": doc[:200] + "..." if len(doc) > 200 else doc,
                    "keywords": metadata.get("keywords", "")
                })
        
        return {
            "filename": filename,
            "document_title": document_info.get("title", filename),
            "file_type": document_info.get("file_type", "unknown"),
            "statistics": {
                "total_chunks": document_info["chunks"],
                "estimated_tokens": document_info["estimated_tokens"],
                "sections_identified": document_info["sections"]
            },
            "content_analysis": {
                "has_methodology": document_info.get("has_methodology", False),
                "has_theory": document_info.get("has_theory", False), 
                "has_references": document_info.get("has_references", False)
            },
            "sample_sections": sample_sections,
            "suggested_queries": [
                f"What methodology does my {filename} propose?",
                f"What are the key theoretical concepts in {filename}?",
                f"What are the main findings in my {document_info.get('title', filename)}?",
                f"How can I improve the approach described in {filename}?"
            ]
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting document insights: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error analyzing document: {str(e)}")

# Also add a debug endpoint to check RAG status:

@router.get("/debug/rag-status")
async def debug_rag_status(request: Request):
    """
    Debug endpoint to check RAG system status
    """
    try:
        session_id = get_or_create_session_for_request(request)
        
        # Get RAG manager
        rag_manager = get_rag_manager()
        
        # Get session stats
        session_stats = session_manager.get_session_stats(session_id)
        
        # Test a simple search
        test_search = rag_manager.search_documents(
            query="test methodology research",
            session_id=session_id,
            persona_context="",
            n_results=3
        )
        
        return {
            "rag_manager_healthy": True,
            "session_id": session_id,
            "session_stats": session_stats.get("rag_stats", {}),
            "test_search_results": len(test_search),
            "test_search_details": [
                {
                    "relevance": chunk.get("relevance_score", 0),
                    "distance": chunk.get("distance", "unknown"),
                    "text_length": len(chunk.get("text", "")),
                    "filename": chunk.get("metadata", {}).get("filename", "unknown")
                }
                for chunk in test_search[:3]
            ],
            "persona_keywords": {
                pid: chat_orchestrator._get_persona_context_keywords(pid)
                for pid in chat_orchestrator.personas.keys()
            }
        }
        
    except Exception as e:
        logger.error(f"Error in RAG debug: {str(e)}")
        return {
            "rag_manager_healthy": False,
            "error": str(e),
            "session_id": session_id if 'session_id' in locals() else "unknown"
        }

# Ask endpoint (SAME INTERFACE)
class PersonaQuery(BaseModel):
    question: str
    persona: str

@router.post("/ask/")
async def ask_question(query: PersonaQuery, request: Request):
    """Ask question - SAME INTERFACE"""
    try:
        session_id = get_or_create_session_for_request(request)
        
        # Use the new orchestrator
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
    


# Root endpoint (SAME INTERFACE)
@router.get("/")
def root():
    """Root endpoint - SAME INTERFACE with updated info"""
    return {
        "message": "Multi-LLM PhD Advisor Backend is up and running",
        "version": __version__,
        "features": [
            "Improved Session Management",
            "Unified Context Handling", 
            "Ollama Support", 
            "Gemini API Support", 
            "Provider Switching"
        ]
    }