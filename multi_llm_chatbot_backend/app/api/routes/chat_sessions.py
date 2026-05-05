from fastapi import APIRouter, HTTPException, Depends, status
from typing import List, Optional
from datetime import datetime
from bson import ObjectId
from app.models.user import User, ChatSession, ChatSessionResponse
from app.core.auth import get_current_active_user
from app.core.database import get_database
from pydantic import BaseModel
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

class CreateChatSessionRequest(BaseModel):
    title: str

class UpdateChatSessionRequest(BaseModel):
    title: Optional[str] = None
    messages: Optional[List[dict]] = None

class SaveMessageRequest(BaseModel):
    session_id: str
    message: dict

async def persist_message(session_id: str, message: dict):
    """Write a single message to a MongoDB chat session."""
    db = get_database()
    msg = message.copy()
    if "timestamp" not in msg:
        msg["timestamp"] = datetime.utcnow().isoformat()
    await db.chat_sessions.update_one(
        {"_id": ObjectId(session_id)},
        {
            "$push": {"messages": msg},
            "$set": {"updated_at": datetime.utcnow()}
        }
    )


@router.post("/chat-sessions", response_model=dict)
async def create_chat_session(
    request: CreateChatSessionRequest,
    current_user: User = Depends(get_current_active_user)
):
    """
    Create a new chat session for the authenticated user.
    @param request: CreateChatSessionRequest with the session title
    @param current_user: Authenticated user from dependency injection
    @return: Dict with the new session id, title, timestamps, and message_count
    """
    try:
        db = get_database()
        
        session = ChatSession(
            user_id=current_user.id,
            title=request.title,
            messages=[],
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        result = await db.chat_sessions.insert_one(session.dict(by_alias=True))
        session.id = result.inserted_id
        
        return {
            "id": str(session.id),
            "title": session.title,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "message_count": 0
        }
        
    except Exception as e:
        logger.error(f"Error creating chat session: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not create chat session"
        )


@router.get("/chat-sessions", response_model=List[ChatSessionResponse])
async def get_user_chat_sessions(
    current_user: User = Depends(get_current_active_user),
    limit: int = 50,
    skip: int = 0
):
    """
    Get all active chat sessions for the authenticated user.
    @param current_user: Authenticated user from dependency injection
    @param limit: Maximum number of sessions to return (default 50)
    @param skip: Number of sessions to skip for pagination (default 0)
    @return: List of ChatSessionResponse sorted by most recently updated
    """
    try:
        db = get_database()
        
        cursor = db.chat_sessions.find(
            {"user_id": current_user.id, "is_active": True}
        ).sort("updated_at", -1).skip(skip).limit(limit)
        
        sessions = []
        async for session_data in cursor:
            sessions.append(ChatSessionResponse(
                id=str(session_data["_id"]),
                title=session_data["title"],
                created_at=session_data["created_at"],
                updated_at=session_data["updated_at"],
                message_count=len(session_data.get("messages", []))
            ))
        
        return sessions
        
    except Exception as e:
        logger.error(f"Error fetching chat sessions: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not fetch chat sessions"
        )



@router.get("/chat-sessions/count")
async def get_chat_sessions_count(
    current_user: User = Depends(get_current_active_user)
):
    """
    Get count of active, non-deleted chat sessions for the authenticated user.
    @param current_user: Authenticated user from dependency injection
    @return: Dict with the session count
    """
    try:
        db = get_database()
        user_object_id = ObjectId(str(current_user.id))
        
        count = await db.chat_sessions.count_documents({
            "user_id": user_object_id,
            "is_active": {"$ne": False},
            "deleted_at": {"$exists": False}
        })
        
        return {"count": count}
        
    except Exception as e:
        logger.error(f"Error counting chat sessions for user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to count chat sessions"
        )



@router.get("/chat-sessions/{session_id}")
async def get_chat_session(
    session_id: str,
    current_user: User = Depends(get_current_active_user)
):
    """
    Get a specific chat session with all messages.
    @param session_id: MongoDB ObjectId of the chat session
    @param current_user: Authenticated user from dependency injection
    @return: Dict with session id, title, messages, and timestamps
    """
    try:
        db = get_database()
        
        session_data = await db.chat_sessions.find_one({
            "_id": ObjectId(session_id),
            "user_id": current_user.id,
            "is_active": True
        })
        
        if not session_data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chat session not found"
            )
        
        return {
            "id": str(session_data["_id"]),
            "title": session_data["title"],
            "messages": session_data.get("messages", []),
            "created_at": session_data["created_at"],
            "updated_at": session_data["updated_at"]
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching chat session: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not fetch chat session"
        )

@router.put("/chat-sessions/{session_id}")
async def update_chat_session(
    session_id: str,
    request: UpdateChatSessionRequest,
    current_user: User = Depends(get_current_active_user)
):
    """
    Update a chat session's title and/or messages.
    @param session_id: MongoDB ObjectId of the chat session
    @param request: UpdateChatSessionRequest with optional title and messages
    @param current_user: Authenticated user from dependency injection
    @return: Dict with a confirmation message
    """
    try:
        db = get_database()
        
        # Verify session belongs to user
        session_data = await db.chat_sessions.find_one({
            "_id": ObjectId(session_id),
            "user_id": current_user.id,
            "is_active": True
        })
        
        if not session_data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chat session not found"
            )
        
        update_data = {"updated_at": datetime.utcnow()}
        
        if request.title is not None:
            update_data["title"] = request.title
        
        if request.messages is not None:
            update_data["messages"] = request.messages
        
        await db.chat_sessions.update_one(
            {"_id": ObjectId(session_id)},
            {"$set": update_data}
        )
        
        return {"message": "Chat session updated successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating chat session: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not update chat session"
        )

@router.post("/chat-sessions/{session_id}/messages")
async def save_message_to_session(
    session_id: str,
    request: SaveMessageRequest,
    current_user: User = Depends(get_current_active_user)
):
    """
    Add a message to a chat session.
    @param session_id: MongoDB ObjectId of the chat session
    @param request: SaveMessageRequest with the message dict
    @param current_user: Authenticated user from dependency injection
    @return: Dict with a confirmation message
    """
    try:
        db = get_database()
        
        # Verify session belongs to user
        session_data = await db.chat_sessions.find_one({
            "_id": ObjectId(session_id),
            "user_id": current_user.id,
            "is_active": True
        })
        
        if not session_data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chat session not found"
            )
        
        await persist_message(session_id, request.message)
        
        return {"message": "Message saved successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving message: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not save message"
        )
    


@router.delete("/chat-sessions")
async def delete_all_chat_sessions(
    current_user: User = Depends(get_current_active_user)
):
    """
    Soft-delete all chat sessions for the authenticated user.
    @param current_user: Authenticated user from dependency injection
    @return: Dict with a confirmation message and the number of deleted sessions
    """
    try:
        db = get_database()

        result = await db.chat_sessions.update_many(
            {
                "user_id": current_user.id,
                "is_active": True
            },
            {"$set": {"is_active": False, "updated_at": datetime.utcnow()}}
        )

        return {
            "message": f"Deleted {result.modified_count} chat sessions",
            "deleted_count": result.modified_count
        }

    except Exception as e:
        logger.error(f"Error deleting all chat sessions for user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not delete chat sessions"
        )


@router.delete("/chat-sessions/{session_id}")
async def delete_chat_session(
    session_id: str,
    current_user: User = Depends(get_current_active_user)
):
    """
    Soft-delete a single chat session.
    @param session_id: MongoDB ObjectId of the chat session
    @param current_user: Authenticated user from dependency injection
    @return: Dict with a confirmation message
    """
    try:
        db = get_database()
        
        result = await db.chat_sessions.update_one(
            {
                "_id": ObjectId(session_id),
                "user_id": current_user.id
            },
            {"$set": {"is_active": False, "updated_at": datetime.utcnow()}}
        )
        
        if result.matched_count == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chat session not found"
            )
        
        return {"message": "Chat session deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting chat session: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not delete chat session"
        )