from pydantic import BaseModel, EmailStr, Field, ConfigDict, model_validator
from typing import Dict, List, Literal, Optional, get_args
from datetime import datetime
from bson import ObjectId

BackendName = Literal["gemini", "ollama", "vllm"]
LLM_BACKENDS = get_args(BackendName)


class UserLLMConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    """Per-user LLM provider configuration.

    Uniform mode:  all advisors and the orchestrator use ``default_backend``.
    Hybrid mode:   each advisor can use a different backend; ``default_backend``
                   is the fallback for any persona not explicitly mapped.
    """
    mode: Literal["uniform", "hybrid"] = "uniform"
    default_backend: BackendName = "gemini"
    orchestrator_backend: Optional[BackendName] = None
    persona_backends: Optional[Dict[str, BackendName]] = None

    @model_validator(mode="after")
    def _validate_hybrid_fields(self):
        if self.mode == "hybrid":
            if not self.orchestrator_backend and not self.persona_backends:
                self.orchestrator_backend = self.default_backend
        else:
            self.orchestrator_backend = None
            self.persona_backends = None
        return self

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
    llm_config: Optional[UserLLMConfig] = None
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
    advisor_skill: Optional[str] = None
    advisor_skill_name: Optional[str] = None
    thoughts: Optional[str] = None
    # Clarification-specific
    suggestions: Optional[List[str]] = None
    # Reply/expand metadata
    isReply: bool = False
    isExpansion: bool = False
    isExpandRequest: bool = False
    replyTo: Optional[ReplyToRef] = None
    # Response grouping — links a user message with its panel + aggregated responses
    response_group_id: Optional[str] = None
    is_aggregated: Optional[bool] = None
    source_personas: Optional[List[str]] = None

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

    @model_validator(mode='after')
    def check_aggregation_metadata(self):
        if self.is_aggregated:
            if self.type != 'advisor':
                raise ValueError("is_aggregated can only be True for advisor messages")
            if self.persona_id != 'aggregated':
                raise ValueError("persona_id must be 'aggregated' when is_aggregated is True")
            if not self.source_personas:
                raise ValueError("source_personas is required when is_aggregated is True")
        if self.source_personas and not self.is_aggregated:
            raise ValueError("source_personas should only be set on aggregated messages")
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
