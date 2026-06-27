import json
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class UserInput(BaseModel):
    user_input: str
    chat_session_id: Optional[str] = None
    advisor_skill: Optional[str] = None


class ChatMessage(BaseModel):
    user_input: str
    user_message_id: Optional[str] = None
    session_id: Optional[str] = None
    chat_session_id: Optional[str] = None  # MongoDB chat session ID
    response_length: str = "medium"
    active_advisors: Optional[List[str]] = None
    advisor_skill: Optional[str] = None
    student_context: Optional[Dict[str, Any]] = None


class ReplyToAdvisor(BaseModel):
    user_input: str
    advisor_id: str
    original_message_id: str = None
    chat_session_id: Optional[str] = None
    advisor_skill: Optional[str] = None


class PersonaQuery(BaseModel):
    question: str
    persona: str


class SwitchChatRequest(BaseModel):
    chat_session_id: str


class NewChatRequest(BaseModel):
    title: Optional[str] = "New Chat"


ChatStreamEventType = Literal[
    "error",
    "progress",
    "clarification",
    "advisor",
    "advisor_start",
    "advisor_delta",
    "advisor_thought_delta",
]


class ChatStreamLine(BaseModel):
    """One NDJSON line from ``/chat-stream``."""

    type: ChatStreamEventType
    data: Dict[str, Any] = Field(default_factory=dict)

    def to_ndjson(self) -> str:
        return json.dumps(self.model_dump(mode="json"), ensure_ascii=False) + "\n"
