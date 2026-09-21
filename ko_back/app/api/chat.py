from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models.user import User, UserRole
from app.schemas.chat import ChatMessageResponse, ChatThreadResponse
from app.services import chat as chat_service

router = APIRouter(prefix="/chat", tags=["chat"])


@router.get("/messages", response_model=list[ChatMessageResponse])
def my_messages(
    limit: int = Query(50, ge=1, le=200),
    before_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ChatMessageResponse]:
    if current_user.role == UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo los clientes tienen un hilo propio")
    messages = chat_service.list_messages(db, current_user.id, limit, before_id)
    return [chat_service.to_response(m) for m in messages]


@router.get("/threads", response_model=list[ChatThreadResponse])
def threads(db: Session = Depends(get_db), _admin: User = Depends(require_admin)) -> list[ChatThreadResponse]:
    return chat_service.list_threads(db)


@router.get("/threads/{customer_id}/messages", response_model=list[ChatMessageResponse])
def thread_messages(
    customer_id: int,
    limit: int = Query(50, ge=1, le=200),
    before_id: int | None = None,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[ChatMessageResponse]:
    if not chat_service.is_customer(db, customer_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    messages = chat_service.list_messages(db, customer_id, limit, before_id)
    return [chat_service.to_response(m) for m in messages]
