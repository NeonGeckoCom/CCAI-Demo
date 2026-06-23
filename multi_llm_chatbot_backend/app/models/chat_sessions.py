from typing import List, Optional

from pydantic import BaseModel


class CreateChatSessionRequest(BaseModel):
    title: str


class UpdateChatSessionRequest(BaseModel):
    title: Optional[str] = None
    messages: Optional[List[dict]] = None


class SaveMessageRequest(BaseModel):
    session_id: str
    message: dict


class TruncateMessagesRequest(BaseModel):
    from_message_id: str
