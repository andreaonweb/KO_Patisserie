import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from anyio import from_thread
from sqlalchemy.orm import Session

from app.models.user import UserRole

logger = logging.getLogger(__name__)

Event = dict[str, Any]


@dataclass(frozen=True)
class WsUser:
    id: int
    role: UserRole


class WsError(Exception):
    """Error de un handler: se envía al remitente como evento `error` y la conexión sigue abierta."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


Handler = Callable[[Session, WsUser, dict[str, Any]], Awaitable[None]]
HANDLERS: dict[str, Handler] = {}


def register(frame_type: str) -> Callable[[Handler], Handler]:
    def decorator(handler: Handler) -> Handler:
        HANDLERS[frame_type] = handler
        return handler

    return decorator


class ConnectionManager:
    """Registro en memoria de conexiones (user_id → sockets). Solo válido con un único proceso."""

    def __init__(self) -> None:
        self._sockets: dict[int, set[Any]] = {}
        self._admins: set[int] = set()

    def connect(self, user_id: int, is_admin: bool, socket: Any) -> None:
        self._sockets.setdefault(user_id, set()).add(socket)
        if is_admin:
            self._admins.add(user_id)

    def disconnect(self, user_id: int, socket: Any) -> None:
        sockets = self._sockets.get(user_id)
        if not sockets:
            return
        sockets.discard(socket)
        if not sockets:
            del self._sockets[user_id]
            self._admins.discard(user_id)

    async def send_to_user(self, user_id: int, event: Event) -> None:
        for socket in list(self._sockets.get(user_id, ())):
            await self._send(user_id, socket, event)

    async def send_to_admins(self, event: Event) -> None:
        for admin_id in list(self._admins):
            await self.send_to_user(admin_id, event)

    async def _send(self, user_id: int, socket: Any, event: Event) -> None:
        try:
            await socket.send_json(event)
        except Exception:
            logger.warning("Socket caído, se descarta", exc_info=True)
            self.disconnect(user_id, socket)

    def reset(self) -> None:
        self._sockets.clear()
        self._admins.clear()


manager = ConnectionManager()


def publish_sync(send: Callable[..., Awaitable[None]], *args: Any) -> None:
    """Publica desde un endpoint síncrono (hilo del threadpool). Nunca debe romper la petición HTTP."""
    try:
        from_thread.run(send, *args)
    except Exception:
        logger.exception("No se pudo publicar el evento en tiempo real")
