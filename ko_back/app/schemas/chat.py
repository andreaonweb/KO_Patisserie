from datetime import datetime

from pydantic import BaseModel


class ChatMessageResponse(BaseModel):
    id: int
    customer_id: int
    sender_id: int
    sender_role: str
    body: str
    created_at: datetime
    read_at: datetime | None


class ChatThreadResponse(BaseModel):
    customer_id: int
    customer_email: str
    last_message: ChatMessageResponse
    unread_count: int
