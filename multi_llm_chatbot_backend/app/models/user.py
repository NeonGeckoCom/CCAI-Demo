from pydantic import BaseModel, EmailStr, Field, ConfigDict, model_validator
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


class ReplyToRef(BaseModel):
    """Reference to the advisor message being replied to."""
    advisorId: str
    advisorName: str
    messageId: str


class PersistMessage(BaseModel):
    """Schema for a single message stored in a ChatSession's messages array."""
    id: str = Field(default_factory=lambda: str(ObjectId()))
    type: MessageType
    content: str
    timestamp: Optional[str] = None
    # Advisor-specific
    persona_id: Optional[str] = None
    advisorName: Optional[str] = None
    used_documents: bool = False
    document_chunks_used: int = 0
    # Clarification-specific
    suggestions: Optional[List[str]] = None
    # Reply/expand metadata
    isReply: bool = False
    isExpansion: bool = False
    isExpandRequest: bool = False
    replyTo: Optional[ReplyToRef] = None

    @model_validator(mode='after')
    def check_type_constraints(self):
        if self.type == 'advisor':
            if not self.persona_id:
                raise ValueError("persona_id is required for advisor messages")
            if not self.advisorName:
                raise ValueError("advisorName is required for advisor messages")
        elif self.type == 'clarification':
            if not self.suggestions:
                raise ValueError("a non-empty suggestions list is required for clarification messages")
        return self

    @model_validator(mode='after')
    def check_reply_metadata(self):
        if self.isReply and not self.replyTo:
            raise ValueError("replyTo is required when isReply is True")
        return self


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