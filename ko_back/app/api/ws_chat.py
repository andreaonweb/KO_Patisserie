from typing import Any

from sqlalchemy.orm import Session

from app.core.realtime import Event, WsError, WsUser, manager, register
from app.models.user import UserRole
from app.services import chat as chat_service


def _thread_customer_id(db: Session, user: WsUser, frame: dict[str, Any]) -> int:
    """Un cliente solo habla en su hilo (se ignora cualquier customer_id); un admin debe indicar uno válido."""
    if user.role == UserRole.CUSTOMER:
        return user.id
    customer_id = frame.get("customer_id")
    if isinstance(customer_id, bool) or not isinstance(customer_id, int) or not chat_service.is_customer(db, customer_id):
        raise WsError("bad_request", "customer_id no válido")
    return customer_id


async def _broadcast(customer_id: int, event: Event) -> None:
    await manager.send_to_user(customer_id, event)
    await manager.send_to_admins(event)


@register("chat.send")
async def chat_send(db: Session, user: WsUser, frame: dict[str, Any]) -> None:
    try:
        body = chat_service.normalize_body(frame.get("body"))
    except ValueError as error:
        raise WsError("bad_request", str(error)) from None
    customer_id = _thread_customer_id(db, user, frame)
    message = chat_service.add_message(db, customer_id, user.id, body)
    payload = chat_service.to_response(message).model_dump(mode="json")
    await _broadcast(customer_id, {"type": "chat.message", "message": payload})


@register("chat.read")
async def chat_read(db: Session, user: WsUser, frame: dict[str, Any]) -> None:
    customer_id = _thread_customer_id(db, user, frame)
    chat_service.mark_read(db, customer_id, user.role)
    await _broadcast(customer_id, {"type": "chat.read", "customer_id": customer_id, "reader_role": user.role.value})
