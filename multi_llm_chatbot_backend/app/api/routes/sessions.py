from fastapi import APIRouter, Request, Depends
from app.core.session_manager import get_session_manager
from app.api.utils import get_or_create_session_for_request_async
from app.core.auth import get_current_active_user
from app.models.user import User
from app.models.sessions import ResetSessionRequest
from typing import Optional
import logging

logger = logging.getLogger(__name__)

router = APIRouter()
session_manager = get_session_manager()


@router.get("/context")
async def get_context(
    request: Request,
    chat_session_id: Optional[str] = None,
    current_user: User = Depends(get_current_active_user)
):
    """
    Get context for current session - ENHANCED with document access fix
    Now properly handles different chat sessions and ensures document access
    """
    try:
        # Determine which session to get context for with consistent session ID format
        if chat_session_id:
            # Getting context for a specific chat session - use consistent format
            session_id = f"chat_{chat_session_id}"
            logger.info(f"Getting context for specific chat session: {session_id}")
            
            # Ensure session is loaded in memory
            if session_id not in session_manager.sessions:
                logger.info(f"Chat session {session_id} not in memory, loading from database")
                loaded_session_id = await get_or_create_session_for_request_async(
                    request,
                    chat_session_id=chat_session_id,
                    user_id=str(current_user.id)
                )
                session_id = loaded_session_id
                logger.info(f"Loaded session ID: {session_id}")
        else:
            # Getting context for current session
            session_id = await get_or_create_session_for_request_async(request)
            logger.info(f"Getting context for current session: {session_id}")
        
        session = session_manager.get_session(session_id)
        rag_stats = session.get_rag_stats()
        
        #  Enhanced logging for document access debugging
        logger.info(f"Retrieved context for session {session_id}:")
        logger.info(f"  - Messages: {len(session.messages)}")
        logger.info(f"  - Documents: {rag_stats.get('total_documents', 0)}")
        logger.info(f"  - Chunks: {rag_stats.get('total_chunks', 0)}")
        logger.info(f"  - Uploaded files: {len(session.uploaded_files)}")
        
        # Log document details if available
        if rag_stats.get('documents'):
            for doc in rag_stats['documents']:
                logger.info(f"  - Available document: {doc.get('filename', 'unknown')} ({doc.get('chunks', 0)} chunks)")
        
        # Include session debugging info in response
        context_response = {
            "session_id": session_id,
            "chat_session_id": chat_session_id,
            "messages": session.messages,
            "rag_info": {
                "total_documents": rag_stats.get("total_documents", 0),
                "total_chunks": rag_stats.get("total_chunks", 0),
                "documents": rag_stats.get("documents", [])
            },
            "context_stats": {
                "message_count": len(session.messages),
                "user_messages": len([m for m in session.messages if m.get('role') == 'user']),
                "uploaded_files": session.uploaded_files,
                "total_upload_size": session.total_upload_size,
                "created_at": session.created_at.isoformat(),
                "last_accessed": session.last_accessed.isoformat()
            },
            # Add debugging info
            "debug_info": {
                "session_format": "chat_session" if chat_session_id else "new_session",
                "session_in_memory": session_id in session_manager.sessions,
                "document_access_working": rag_stats.get("total_documents", 0) > 0
            }
        }
        
        return context_response
        
    except Exception as e:
        logger.error(f"Error getting context for session_id {session_id if 'session_id' in locals() else 'unknown'}: {str(e)}")
        logger.error(f"Chat session ID: {chat_session_id}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        
        return {
            "session_id": session_id if 'session_id' in locals() else None,
            "chat_session_id": chat_session_id,
            "messages": [], 
            "rag_info": {"total_documents": 0, "total_chunks": 0, "documents": []},
            "context_stats": {
                "message_count": 0,
                "user_messages": 0,
                "uploaded_files": [],
                "total_upload_size": 0
            },
            "error": str(e),
            "debug_info": {
                "error_occurred": True,
                "error_type": type(e).__name__
            }
        }

@router.post("/reset-session")
async def reset_session(
    reset_request: ResetSessionRequest,
    request: Request,
    current_user: User = Depends(get_current_active_user)
):
    """
    Reset session - ENHANCED
    Now properly handles different reset scenarios
    """
    try:
        if reset_request.force_new:
            # Force create a completely new session
            session_id = session_manager.create_session()
            session = session_manager.get_session(session_id)
            session.clear_all_data()
            
            logger.info(f"Force created new session: {session_id}")
            
            return {
                "status": "reset", 
                "message": "New session created with fresh context",
                "session_id": session_id,
                "chat_session_id": None
            }
        
        elif reset_request.chat_session_id:
            # Reset a specific chat session context
            session_id = f"chat_{reset_request.chat_session_id}"
            
            if session_id in session_manager.sessions:
                success = session_manager.reset_session_completely(session_id)
                message = "Chat session context reset successfully" if success else "Failed to reset chat session context"
            else:
                # Create fresh context for this chat
                session = session_manager.get_session(session_id)
                session.clear_all_data()
                success = True
                message = "Fresh context created for chat session"
            
            logger.info(f"Reset chat session {reset_request.chat_session_id}, memory session: {session_id}")
            
            return {
                "status": "reset" if success else "error",
                "message": message,
                "session_id": session_id,
                "chat_session_id": reset_request.chat_session_id
            }
        
        else:
            # Reset current session
            session_id = await get_or_create_session_for_request_async(request)
            success = session_manager.reset_session_completely(session_id)
            
            logger.info(f"Reset current session: {session_id}")
            
            return {
                "status": "reset" if success else "error",
                "message": "Current session reset successfully" if success else "Failed to reset current session",
                "session_id": session_id
            }
            
    except Exception as e:
        logger.error(f"Error resetting session: {e}")
        return {"status": "error", "message": f"Failed to reset session: {str(e)}"}

@router.get("/session-stats")
async def get_session_stats(
    request: Request,
    chat_session_id: Optional[str] = None,
    current_user: User = Depends(get_current_active_user)
):
    """
    Get session statistics - ENHANCED
    Now provides detailed stats for different session types
    """
    try:
        if chat_session_id:
            # Stats for specific chat session
            session_id = f"chat_{chat_session_id}"
        else:
            # Stats for current session
            session_id = await get_or_create_session_for_request_async(request)
        
        stats = session_manager.get_session_stats(session_id)
        
        # Add additional context
        stats["session_type"] = "chat_session" if chat_session_id else "current_session"
        stats["chat_session_id"] = chat_session_id
        
        return stats
        
    except Exception as e:
        logger.error(f"Error getting session stats: {str(e)}")
        return {"error": str(e)}

@router.get("/active-sessions")
async def get_active_sessions(current_user: User = Depends(get_current_active_user)):
    """
    Get all active sessions for debugging
    """
    try:
        active_count = session_manager.get_active_session_count()
        
        # Get overview of sessions (don't return full content for privacy)
        session_overview = {}
        for session_id, session in session_manager.sessions.items():
            session_overview[session_id] = {
                "message_count": len(session.messages),
                "uploaded_files": len(session.uploaded_files),
                "created_at": session.created_at.isoformat(),
                "last_accessed": session.last_accessed.isoformat(),
                "is_chat_session": session_id.startswith("chat_")
            }
        
        return {
            "active_session_count": active_count,
            "sessions": session_overview
        }
        
    except Exception as e:
        logger.error(f"Error getting active sessions: {str(e)}")
        return {"error": str(e)}

@router.post("/cleanup-sessions")
async def cleanup_expired_sessions(current_user: User = Depends(get_current_active_user)):
    """
    Manually trigger session cleanup
    """
    try:
        initial_count = session_manager.get_active_session_count()
        
        # Force cleanup
        session_manager._cleanup_expired_sessions()
        
        final_count = session_manager.get_active_session_count()
        cleaned_count = initial_count - final_count
        
        return {
            "status": "success",
            "message": f"Cleaned up {cleaned_count} expired sessions",
            "sessions_before": initial_count,
            "sessions_after": final_count
        }
        
    except Exception as e:
        logger.error(f"Error during session cleanup: {str(e)}")
        return {"status": "error", "message": str(e)}
