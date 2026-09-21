from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.chat import ChatMessage
from app.models.user import User, UserRole
from app.schemas.chat import ChatMessageResponse, ChatThreadResponse

MAX_BODY_LENGTH = 1000


def normalize_body(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("El mensaje debe ser texto")
    body = value.strip()
    if not 1 <= len(body) <= MAX_BODY_LENGTH:
        raise ValueError(f"El mensaje debe tener entre 1 y {MAX_BODY_LENGTH} caracteres")
    return body


def is_customer(db: Session, user_id: int) -> bool:
    user = db.get(User, user_id)
    return user is not None and user.role == UserRole.CUSTOMER


def to_response(message: ChatMessage) -> ChatMessageResponse:
    return ChatMessageResponse(
        id=message.id,
        customer_id=message.customer_id,
        sender_id=message.sender_id,
        sender_role=message.sender.role.value,
        body=message.body,
        created_at=message.created_at,
        read_at=message.read_at,
    )


def add_message(db: Session, customer_id: int, sender_id: int, body: str) -> ChatMessage:
    message = ChatMessage(customer_id=customer_id, sender_id=sender_id, body=body)
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


def mark_read(db: Session, customer_id: int, reader_role: UserRole) -> None:
    """El admin lee los mensajes del cliente; el cliente, los de los admins."""
    query = db.query(ChatMessage).filter(ChatMessage.customer_id == customer_id, ChatMessage.read_at.is_(None))
    if reader_role == UserRole.ADMIN:
        query = query.filter(ChatMessage.sender_id == customer_id)
    else:
        query = query.filter(ChatMessage.sender_id != customer_id)
    query.update({ChatMessage.read_at: func.now()}, synchronize_session=False)
    db.commit()


def list_messages(db: Session, customer_id: int, limit: int = 50, before_id: int | None = None) -> list[ChatMessage]:
    query = db.query(ChatMessage).filter(ChatMessage.customer_id == customer_id)
    if before_id is not None:
        query = query.filter(ChatMessage.id < before_id)
    return list(reversed(query.order_by(ChatMessage.id.desc()).limit(limit).all()))


def list_threads(db: Session) -> list[ChatThreadResponse]:
    last_ids = [row[0] for row in db.query(func.max(ChatMessage.id)).group_by(ChatMessage.customer_id).all()]
    if not last_ids:
        return []
    lasts = db.query(ChatMessage).filter(ChatMessage.id.in_(last_ids)).order_by(ChatMessage.id.desc()).all()
    unread = dict(
        db.query(ChatMessage.customer_id, func.count())
        .filter(ChatMessage.read_at.is_(None), ChatMessage.sender_id == ChatMessage.customer_id)
        .group_by(ChatMessage.customer_id)
        .all()
    )
    return [
        ChatThreadResponse(
            customer_id=m.customer_id,
            customer_email=m.customer.email,
            last_message=to_response(m),
            unread_count=unread.get(m.customer_id, 0),
        )
        for m in lasts
    ]
