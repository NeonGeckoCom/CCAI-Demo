from typing import Optional

from pydantic import BaseModel


class ResetSessionRequest(BaseModel):
    chat_session_id: Optional[str] = None
    force_new: bool = False
