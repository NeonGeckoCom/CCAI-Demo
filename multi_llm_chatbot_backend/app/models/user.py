from pydantic import BaseModel, EmailStr, Field, ConfigDict, model_validator
from typing import Dict, Literal, Optional, List, Any, get_args
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
                raise ValueError(
                    "hybrid mode requires at least one of "
                    "orchestrator_backend or persona_backends"
                )
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

class ChatSession(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str}
    )
    
    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")
    user_id: PyObjectId
    title: str
    messages: List[dict] = []
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