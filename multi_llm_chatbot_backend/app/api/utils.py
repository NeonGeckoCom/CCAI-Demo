from typing import Optional
from fastapi import Request
from app.core.session_manager import get_session_manager
from app.core.database import get_database
from bson import ObjectId
import logging

logger = logging.getLogger(__name__)
session_manager = get_session_manager()

async def load_chat_session_into_context(chat_session_id: str, user_id: str) -> str:
    """
    Load a chat session from MongoDB into memory context - ENHANCED DEBUG VERSION
    """
    try:
        db = get_database()
        
        # Add enhanced debugging
        logger.info(f"=== LOADING CHAT SESSION DEBUG ===")
        logger.info(f"Attempting to load chat_session_id: {chat_session_id}")
        logger.info(f"For user_id: {user_id}")
        
        # Try to find the session with enhanced debugging
        chat_session = await db.chat_sessions.find_one({
            "_id": ObjectId(chat_session_id),
            "user_id": ObjectId(user_id),
            "deleted_at": {"$exists": False}
        })
        
        if not chat_session:
            logger.warning(f"Chat session {chat_session_id} not found for user {user_id}")
            
            # Debug: Check if session exists for any user
            try:
                session_exists = await db.chat_sessions.find_one({"_id": ObjectId(chat_session_id)})
                if session_exists:
                    logger.warning(f"Session exists but for different user: {session_exists.get('user_id')}")
                    logger.warning(f"Expected user: {user_id}")
                    logger.warning(f"Session user: {session_exists.get('user_id')}")
                    logger.warning(f"User ID types - Expected: {type(user_id)}, Found: {type(session_exists.get('user_id'))}")
                else:
                    logger.warning(f"Session {chat_session_id} does not exist in database at all")
            except Exception as debug_error:
                logger.error(f"Error during session debug: {debug_error}")
            
            # Debug: List recent sessions for this user
            try:
                recent_sessions = await db.chat_sessions.find(
                    {"user_id": ObjectId(user_id), "deleted_at": {"$exists": False}}
                ).limit(5).to_list(5)
                logger.info(f"Recent sessions for user {user_id}: {[str(s['_id']) for s in recent_sessions]}")
            except Exception as debug_error:
                logger.error(f"Error listing recent sessions: {debug_error}")
            
            return None

        logger.info(f"✅ Found chat session: {chat_session.get('title', 'Untitled')}")
        logger.info(f"✅ Message count: {len(chat_session.get('messages', []))}")
        
        # Create consistent memory session ID  
        memory_session_id = f"chat_{chat_session_id}"
        logger.info(f"✅ Creating memory session: {memory_session_id}")
        
        # Get session manager and create memory session
        session_manager = get_session_manager()
        memory_session = session_manager.get_session(memory_session_id)
        
        # Clear any existing data
        memory_session.clear_all_data()
        
        # Load messages into memory session
        messages = chat_session.get('messages', [])
        for msg_data in messages:
            try:
                message = {
                    'id': msg_data.get('id', 'unknown'),
                    'role': 'user' if msg_data.get('type') == 'user' else 'assistant',
                    'content': msg_data.get('content', ''),
                    'timestamp': msg_data.get('timestamp', '')
                }
                memory_session.append_message(message['role'], message['content'])
                
                # Store original message for export
                if not hasattr(memory_session, 'original_messages'):
                    memory_session.original_messages = []
                
                memory_session.original_messages.append(message)
            except Exception as msg_error:
                logger.error(f"Error loading message: {msg_error}")
                continue
        
        logger.info(f"Loaded {len(messages)} messages into session {memory_session_id}")
        return memory_session_id
        
    except Exception as e:
        logger.error(f"Error loading chat session into context: {e}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return None

async def get_or_create_session_for_request_async(
    request: Request, 
    session_id_override: Optional[str] = None,
    chat_session_id: Optional[str] = None,
    user_id: Optional[str] = None
) -> str:
    """
    Async version that properly handles chat session loading
    """
    
    # Case 1: Loading an existing chat session
    if chat_session_id and user_id:
        memory_session_id = await load_chat_session_into_context(chat_session_id, user_id)
        if memory_session_id:
            return memory_session_id
        # If loading failed, create new session
    
    # Case 2: Explicit session ID provided
    if session_id_override:
        return session_id_override

    # Case 3: Check for session header
    session_header = request.headers.get("X-Session-ID")
    if session_header:
        return session_header

    # Case 4: Create a truly new session
    new_session_id = session_manager.create_session()
    logger.info(f"Created new session: {new_session_id}")
    return new_session_id


def get_or_create_session_for_request(
    request: Request,
    session_id_override: Optional[str] = None,
) -> str:
    """
    Get or create a session for a request using multiple strategies:
    1. Use the provided session_id if given
    2. Use the X-Session-ID header if present
    3. Use the client IP as a fallback for backward compatibility
    4. Create a new session if nothing else is available
    """
    # Strategy 1: Explicit session ID (for new clients)
    if session_id_override:
        return session_id_override

    # Strategy 2: Check for a session header (optional for the frontend)
    session_header = request.headers.get("X-Session-ID")
    if session_header:
        return session_header

    # Strategy 3: Use client IP for backward compatibility — each client IP
    # gets its own persistent session.
    client_ip = request.client.host if request.client else "unknown"
    ip_session_id = f"ip_{client_ip}"
    session = session_manager.get_session(ip_session_id)
    return session.session_id