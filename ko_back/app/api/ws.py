import asyncio
import json
import logging
import time
from collections import deque
from collections.abc import Callable
from typing import Any

import jwt
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.api import ws_chat  # noqa: F401  (registra los handlers de chat)
from app.core.database import get_session_factory
from app.core.origins import ALLOWED_ORIGINS
from app.core.realtime import HANDLERS, WsError, WsUser, manager
from app.core.security import decode_access_token
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)
router = APIRouter()

HANDSHAKE_TIMEOUT_S = 5.0
RATE_LIMIT_FRAMES = 20
RATE_LIMIT_WINDOW_S = 10.0
CLOSE_UNAUTHORIZED = 4401
CLOSE_FORBIDDEN_ORIGIN = 4403

SessionFactory = Callable[[], Session]


def _origin_allowed(origin: str | None) -> bool:
    # Los navegadores siempre envían Origin; los clientes que no lo son (tests, scripts) no.
    return origin is None or origin in ALLOWED_ORIGINS


async def _send_error(websocket: WebSocket, code: str, detail: str) -> None:
    await websocket.send_json({"type": "error", "code": code, "detail": detail})


async def _handshake(websocket: WebSocket, session_factory: SessionFactory) -> WsUser | None:
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=HANDSHAKE_TIMEOUT_S)
        frame = json.loads(raw)
        token = frame.get("type") == "auth" and frame.get("token")
        if not isinstance(token, str):
            raise ValueError("Se esperaba un frame auth")
        user_id = int(decode_access_token(token)["sub"])
    except WebSocketDisconnect:
        return None
    except (asyncio.TimeoutError, ValueError, KeyError, AttributeError, jwt.PyJWTError):
        await websocket.close(code=CLOSE_UNAUTHORIZED)
        return None

    db = session_factory()
    try:
        user = db.get(User, user_id)
        ws_user = WsUser(id=user.id, role=user.role) if user is not None else None
    finally:
        db.close()
    if ws_user is None:
        await websocket.close(code=CLOSE_UNAUTHORIZED)
    return ws_user


async def _dispatch(websocket: WebSocket, session_factory: SessionFactory, user: WsUser, raw: str) -> None:
    try:
        frame: Any = json.loads(raw)
    except ValueError:
        await _send_error(websocket, "bad_request", "El frame no es JSON válido")
        return
    if not isinstance(frame, dict) or not isinstance(frame.get("type"), str):
        await _send_error(websocket, "bad_request", "El frame debe ser un objeto con `type`")
        return
    handler = HANDLERS.get(frame["type"])
    if handler is None:
        await _send_error(websocket, "unknown_type", f"Tipo desconocido: {frame['type']}")
        return

    db = session_factory()
    try:
        await handler(db, user, frame)
    except WsError as error:
        await _send_error(websocket, error.code, error.detail)
    except Exception:
        logger.exception("Error inesperado procesando %s", frame["type"])
        await _send_error(websocket, "internal", "Error interno")
    finally:
        db.close()


async def _receive_loop(websocket: WebSocket, session_factory: SessionFactory, user: WsUser) -> None:
    recent: deque[float] = deque()
    while True:
        raw = await websocket.receive_text()
        now = time.monotonic()
        while recent and now - recent[0] > RATE_LIMIT_WINDOW_S:
            recent.popleft()
        if len(recent) >= RATE_LIMIT_FRAMES:
            await _send_error(websocket, "rate_limited", "Demasiados mensajes, espera unos segundos")
            continue
        recent.append(now)
        await _dispatch(websocket, session_factory, user, raw)


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket, session_factory: SessionFactory = Depends(get_session_factory)
) -> None:
    await websocket.accept()
    if not _origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=CLOSE_FORBIDDEN_ORIGIN)
        return
    user = await _handshake(websocket, session_factory)
    if user is None:
        return

    manager.connect(user.id, user.role == UserRole.ADMIN, websocket)
    try:
        await websocket.send_json({"type": "ready", "user": {"id": user.id, "role": user.role.value}})
        await _receive_loop(websocket, session_factory, user)
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(user.id, websocket)
