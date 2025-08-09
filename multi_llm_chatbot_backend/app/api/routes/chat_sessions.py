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

@router.post("/chat-sessions", response_model=dict)
async def create_chat_session(
    request: CreateChatSessionRequest,
    current_user: User = Depends(get_current_active_user)
):
    """Create a new chat session for the user"""
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
    """Get all chat sessions for the current user"""
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

@router.get("/chat-sessions/{session_id}")
async def get_chat_session(
    session_id: str,
    current_user: User = Depends(get_current_active_user)
):
    """Get a specific chat session with all messages"""
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
    """Update a chat session (title or messages)"""
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
    """Add a message to a chat session"""
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
        
        # Add timestamp to message if not present
        message = request.message.copy()
        if "timestamp" not in message:
            message["timestamp"] = datetime.utcnow().isoformat()
        
        await db.chat_sessions.update_one(
            {"_id": ObjectId(session_id)},
            {
                "$push": {"messages": message},
                "$set": {"updated_at": datetime.utcnow()}
            }
        )
        
        return {"message": "Message saved successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving message: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not save message"
        )

@router.delete("/chat-sessions/{session_id}")
async def delete_chat_session(
    session_id: str,
    current_user: User = Depends(get_current_active_user)
):
    """Delete a chat session (soft delete)"""
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