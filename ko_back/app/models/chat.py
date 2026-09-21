from datetime import datetime

from sqlalchemy import ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.models.user import User


class ChatMessage(Base):
    """Un mensaje de un hilo. El hilo de un cliente es simplemente su `customer_id`."""

    __tablename__ = "chat_message"
    __table_args__ = (Index("ix_chat_message_customer_id_id", "customer_id", "id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("user.id"))
    sender_id: Mapped[int] = mapped_column(ForeignKey("user.id"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    read_at: Mapped[datetime | None] = mapped_column(nullable=True)

    sender: Mapped[User] = relationship(foreign_keys=[sender_id])
    customer: Mapped[User] = relationship(foreign_keys=[customer_id])
