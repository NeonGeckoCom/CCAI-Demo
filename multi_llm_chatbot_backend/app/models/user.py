from pydantic import BaseModel, EmailStr, Field, ConfigDict
from typing import Literal, Optional, List, Any
from datetime import datetime
from bson import ObjectId

class PyObjectId(ObjectId):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v, handler=None):
        if isinstance(v, ObjectId):
            return v
        if isinstance(v, str):
            if ObjectId.is_valid(v):
                return ObjectId(v)
        raise ValueError("Invalid ObjectId")

    @classmethod
    def __get_pydantic_json_schema__(cls, field_schema):
        field_schema.update(type="string")

class UserCreate(BaseModel):
    firstName: str
    lastName: str
    email: EmailStr
    password: str
    academicStage: Optional[str] = None
    researchArea: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class User(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str}
    )
    
    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")
    firstName: str
    lastName: str
    email: EmailStr
    hashed_password: str
    academicStage: Optional[str] = None
    researchArea: Optional[str] = None
    disabled_advisors: Optional[List[str]] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_login: Optional[datetime] = None
    is_active: bool = True

class UserResponse(BaseModel):
    id: str
    firstName: str
    lastName: str
    email: str
    academicStage: Optional[str] = None
    researchArea: Optional[str] = None
    created_at: datetime
    last_login: Optional[datetime] = None

MessageType = Literal[
    "user", "advisor", "error", "clarification", "document_upload", "system",
]


class PersistMessage(BaseModel):
    """Schema for a single message stored in a ChatSession's messages array."""
    id: str = Field(default_factory=lambda: str(ObjectId()))
    type: MessageType
    content: str
    timestamp: Optional[str] = None
    # Advisor-specific
    persona_id: Optional[str] = None
    persona_name: Optional[str] = None
    used_documents: bool = False
    document_chunks_used: int = 0
    # Error-specific
    code: Optional[str] = None
    # Clarification-specific
    suggestions: Optional[List[str]] = None
    # Reply/expand metadata
    isReply: bool = False
    isExpansion: bool = False
    isExpandRequest: bool = False
    replyTo: Optional[dict] = None


class ChatSession(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str}
    )
    
    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")
    user_id: PyObjectId
    title: str
    messages: List[PersistMessage] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    is_active: bool = True

class ChatSessionResponse(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int

class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse