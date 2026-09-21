# WebSocket Realtime + Help Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One authenticated WebSocket per logged-in user that carries a customer↔admin help chat (persisted, one thread per customer) and live order updates, replacing the 10 s polling.

**Architecture:** A single `/ws` endpoint (FastAPI) authenticates with a JWT sent as the first frame, then multiplexes typed JSON events. An in-memory `ConnectionManager` delivers events to a user or to all admins; REST endpoints serve history and lists and publish order events. In Angular, `RealtimeService` owns the socket; `ChatService` and the order screens consume its event stream.

**Tech Stack:** FastAPI + Starlette websockets, SQLAlchemy (sync) + Alembic, PostgreSQL (SQLite in tests), pytest; Angular 21 standalone + signals + RxJS, `lucide-angular`, Vitest via `ng test`.

**Spec:** `docs/superpowers/specs/2026-09-21-websocket-chat-design.md`

## Global Constraints

- Message `body`: trimmed, 1–1000 characters, stored and rendered as plain text (never HTML).
- Handshake: first frame `{"type":"auth","token":"<jwt>"}` within **5 s**; failure closes with **4401**; `Origin` present and not in the CORS allow-list closes with **4403**; a missing `Origin` is allowed. Role is read from the DB, never from the token.
- Allow-list: `http://localhost:4200`, shared by CORS and the websocket (`app/core/origins.py`).
- Rate limit: **20** client frames per **10 s** per connection → `error` code `rate_limited`, connection stays open. Bad frames → `bad_request` / `unknown_type`.
- Events (server → client): `ready`, `chat.message`, `chat.read`, `order.created`, `order.updated`, `error`. Flat payloads, e.g. `{"type":"chat.message","message":{...}}`.
- Message shape: `{id, customer_id, sender_id, sender_role, body, created_at, read_at}`. A customer's message is unread until any admin marks the thread read; an admin's until the customer does.
- REST: `GET /chat/messages?limit=50&before_id=` (customer), `GET /chat/threads` (admin), `GET /chat/threads/{customer_id}/messages?limit=50&before_id=` (admin).
- No offline outbox: sending is disabled while the sender's own socket is down. A recipient being offline never loses a message.
- Single uvicorn process (in-memory registry). Reconnect backoff 1 s → 30 s; no retry after 4401.
- UI copy in Spanish, **no emojis** (icons from `lucide-angular`); each component stylesheet must stay under the 8 kB budget error (aim for < 4 kB).
- Commits: conventional style (`feat(backend): …`, `feat(frontend): …`, `test: …`), always with the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (second `-m`).
- Baseline: the frontend suite has **3 known failing tests** (`App > should render title`, `Home > should create`, `ProductCard > should create`). Never fix them here and never add to them.
- Windows/Git Bash: use `uv run …` in `ko_back` and `npx ng …` in `ko_front`. The dev API runs **without `--reload`**; restart it after backend changes.
- Push only after the user confirms; every branch is cut from `dev` after the previous one is merged with `--no-ff`.

## Commands used in every task

Backend tests (from `ko_back`):

```bash
uv run pytest -q
```

Frontend tests and build (from `ko_front`):

```bash
npx ng test --watch=false 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests |FAIL"
npx ng build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "ERROR|complete"
```

"Frontend green" means: only the 3 known failures remain and the build says `complete`.

Restart the API (PowerShell to stop, then start in the background):

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'python|uv' -and $_.CommandLine -match 'uvicorn' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
```

```bash
cd ko_back && uv run uvicorn app.main:app --port 8000
```

## File structure

Backend (`ko_back/app`):

| file | responsibility |
|---|---|
| `core/origins.py` | `ALLOWED_ORIGINS`, shared by CORS and websocket |
| `core/realtime.py` | `ConnectionManager` + `manager`, `WsUser`, `WsError`, `HANDLERS`/`register`, `publish_sync` |
| `core/database.py` | + `get_session_factory` dependency (overridable in tests) |
| `api/ws.py` | `/ws` endpoint: origin check, handshake, receive loop, rate limit, dispatch |
| `api/ws_chat.py` | `chat.send` / `chat.read` handlers |
| `models/chat.py`, `schemas/chat.py` | `ChatMessage` model, response schemas |
| `services/chat.py` | chat persistence and queries (used by REST and websocket) |
| `api/chat.py` | chat REST endpoints |
| `api/orders.py` | + publishes `order.created` / `order.updated` |

Frontend (`ko_front/src/app`):

| file | responsibility |
|---|---|
| `core/models/realtime.model.ts` | connection status + `ServerEvent` union |
| `core/models/chat.model.ts` | chat types (API and camelCase) |
| `core/services/realtime.service.ts` | the only code touching `WebSocket` |
| `core/services/chat.service.ts` | chat state for customer and admin |
| `core/utils/orders.ts` | `upsertOrder` |
| `shared/components/chat-widget/*` | floating help button + panel (customers) |
| `pages/admin/admin-chat/*` | admin chat tab (thread list + conversation) |

---

## Branch 0 — merge the design docs

### Task 0: Merge spec and plan into `dev`

**Files:** none (git only).

- [ ] **Step 1: Confirm the plan and spec are committed on `docs/ws-chat-spec`**

```bash
git checkout docs/ws-chat-spec && git status --short && git log --oneline -4
```

Expected: clean tree; the last commits are the spec, its clarifications and this plan.

- [ ] **Step 2: Merge into `dev`**

```bash
git checkout dev
git merge --no-ff docs/ws-chat-spec -m "Merge docs/ws-chat-spec into dev" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git log --oneline -3
```

Expected: a merge commit on top of `dev`.

---

## Branch 1 — `feat/ws-core`

```bash
git checkout dev && git checkout -b feat/ws-core
```

### Task 1: Shared origins and `ConnectionManager`

**Files:**
- Create: `ko_back/app/core/origins.py`, `ko_back/app/core/realtime.py`, `ko_back/tests/test_realtime_manager.py`
- Modify: `ko_back/app/main.py`

**Interfaces:**
- Produces: `ALLOWED_ORIGINS: list[str]`; `WsUser(id: int, role: UserRole)`; `WsError(code: str, detail: str)`; `HANDLERS: dict[str, Handler]`; `register(frame_type) -> decorator`; `manager: ConnectionManager` with `connect(user_id, is_admin, socket)`, `disconnect(user_id, socket)`, `async send_to_user(user_id, event)`, `async send_to_admins(event)`, `reset()`; `publish_sync(send, *args)`.

- [ ] **Step 1: Write the failing tests** — `ko_back/tests/test_realtime_manager.py`

```python
import asyncio

from app.core.realtime import ConnectionManager


class FakeSocket:
    def __init__(self, fail: bool = False) -> None:
        self.sent: list[dict] = []
        self.fail = fail

    async def send_json(self, event: dict) -> None:
        if self.fail:
            raise RuntimeError("closed")
        self.sent.append(event)


def test_send_to_user_reaches_every_tab_of_that_user() -> None:
    manager = ConnectionManager()
    tab1, tab2 = FakeSocket(), FakeSocket()
    manager.connect(1, False, tab1)
    manager.connect(1, False, tab2)

    asyncio.run(manager.send_to_user(1, {"type": "x"}))

    assert tab1.sent == [{"type": "x"}]
    assert tab2.sent == [{"type": "x"}]


def test_send_to_user_ignores_other_users() -> None:
    manager = ConnectionManager()
    mine, other = FakeSocket(), FakeSocket()
    manager.connect(1, False, mine)
    manager.connect(2, False, other)

    asyncio.run(manager.send_to_user(1, {"type": "x"}))

    assert other.sent == []


def test_send_to_admins_reaches_only_admins() -> None:
    manager = ConnectionManager()
    admin, customer = FakeSocket(), FakeSocket()
    manager.connect(1, True, admin)
    manager.connect(2, False, customer)

    asyncio.run(manager.send_to_admins({"type": "x"}))

    assert admin.sent == [{"type": "x"}]
    assert customer.sent == []


def test_disconnecting_the_last_tab_removes_admin_membership() -> None:
    manager = ConnectionManager()
    admin = FakeSocket()
    manager.connect(1, True, admin)
    manager.disconnect(1, admin)

    asyncio.run(manager.send_to_admins({"type": "x"}))

    assert admin.sent == []


def test_a_dead_socket_is_dropped_without_breaking_the_others() -> None:
    manager = ConnectionManager()
    dead, alive = FakeSocket(fail=True), FakeSocket()
    manager.connect(1, False, dead)
    manager.connect(1, False, alive)

    asyncio.run(manager.send_to_user(1, {"type": "x"}))
    asyncio.run(manager.send_to_user(1, {"type": "y"}))

    assert alive.sent == [{"type": "x"}, {"type": "y"}]
    assert dead.sent == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_realtime_manager.py -q` (from `ko_back`)
Expected: FAIL — `ModuleNotFoundError: app.core.realtime`.

- [ ] **Step 3: Implement** — `ko_back/app/core/origins.py`

```python
"""Orígenes de navegador permitidos: los comparten CORS y el handshake del websocket."""

ALLOWED_ORIGINS = ["http://localhost:4200"]
```

`ko_back/app/core/realtime.py`

```python
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
```

Modify `ko_back/app/main.py`: add `from app.core.origins import ALLOWED_ORIGINS` and change `allow_origins=["http://localhost:4200"],` to `allow_origins=ALLOWED_ORIGINS,`.

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest -q` — Expected: all pass (existing tests plus 5 new).

- [ ] **Step 5: Commit**

```bash
git add ko_back/app/core/origins.py ko_back/app/core/realtime.py ko_back/app/main.py ko_back/tests/test_realtime_manager.py
git commit -m "feat(backend): add in-memory websocket ConnectionManager and shared allowed origins" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

### Task 2: `/ws` endpoint (handshake, origin, rate limit, dispatch)

**Files:**
- Create: `ko_back/app/api/ws.py`, `ko_back/tests/test_ws.py`
- Modify: `ko_back/app/core/database.py`, `ko_back/app/main.py`, `ko_back/tests/conftest.py`

**Interfaces:**
- Consumes: `manager`, `WsUser`, `WsError`, `HANDLERS` from Task 1; `decode_access_token`, `create_access_token` from `app.core.security`.
- Produces: `get_session_factory() -> Callable[[], Session]` (override point for tests); module constants `HANDSHAKE_TIMEOUT_S = 5.0`, `RATE_LIMIT_FRAMES = 20`, `RATE_LIMIT_WINDOW_S = 10.0` in `app.api.ws`; conftest fixtures `db_engine` and a `client` that also overrides the session factory and resets `manager`.

- [ ] **Step 1: Make the test infrastructure ready** — replace `ko_back/tests/conftest.py` with:

```python
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.core.database import Base, get_db, get_session_factory
from app.core.realtime import manager
from app.main import app
from app.scripts.seed_admin import ADMIN_EMAIL, ADMIN_PASSWORD, seed_admin


@pytest.fixture
def db_engine() -> Generator[Engine, None, None]:
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(db_engine: Engine) -> Generator[Session, None, None]:
    session = sessionmaker(bind=db_engine)()
    yield session
    session.close()


@pytest.fixture
def client(db_session: Session, db_engine: Engine) -> Generator[TestClient, None, None]:
    session_factory = sessionmaker(bind=db_engine, autoflush=False)

    def override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_session_factory] = lambda: session_factory
    manager.reset()
    yield TestClient(app)
    app.dependency_overrides.clear()
    manager.reset()


@pytest.fixture
def admin_token(client: TestClient, db_session: Session) -> str:
    seed_admin(db_session)
    response = client.post("/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    return response.json()["access_token"]


@pytest.fixture
def customer_token(client: TestClient) -> str:
    response = client.post("/auth/register", json={"email": "cliente@test.com", "password": "secret123"})
    return response.json()["access_token"]
```

Add to `ko_back/app/core/database.py` (after `get_db`; add `Callable` to the imports):

```python
from collections.abc import Callable, Generator
```

```python
def get_session_factory() -> Callable[[], Session]:
    """Fábrica de sesiones cortas para el websocket (una por frame). Se sobrescribe en los tests."""
    return SessionLocal
```

- [ ] **Step 2: Write the failing tests** — `ko_back/tests/test_ws.py`

```python
import pytest
from starlette.websockets import WebSocketDisconnect

import app.api.ws as ws_module
from app.core.realtime import HANDLERS, WsError, manager
from app.core.security import create_access_token
from app.models.user import User, UserRole


def _expect_close(ws, code: int) -> None:
    with pytest.raises(WebSocketDisconnect) as exc:
        ws.receive_json()
    assert exc.value.code == code


def _auth(ws, token: str) -> None:
    ws.send_json({"type": "auth", "token": token})


def test_valid_token_receives_ready(client, customer_token) -> None:
    with client.websocket_connect("/ws") as ws:
        _auth(ws, customer_token)
        ready = ws.receive_json()
    assert ready["type"] == "ready"
    assert ready["user"]["role"] == "customer"


def test_allowed_origin_is_accepted(client, customer_token) -> None:
    with client.websocket_connect("/ws", headers={"origin": "http://localhost:4200"}) as ws:
        _auth(ws, customer_token)
        assert ws.receive_json()["type"] == "ready"


def test_disallowed_origin_is_closed_with_4403(client, customer_token) -> None:
    with client.websocket_connect("/ws", headers={"origin": "http://evil.example"}) as ws:
        _expect_close(ws, 4403)


def test_invalid_token_is_closed_with_4401(client) -> None:
    with client.websocket_connect("/ws") as ws:
        _auth(ws, "not-a-jwt")
        _expect_close(ws, 4401)


def test_first_frame_must_be_auth(client, customer_token) -> None:
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "chat.send", "body": "hola"})
        _expect_close(ws, 4401)


def test_handshake_timeout_is_closed_with_4401(client, monkeypatch) -> None:
    monkeypatch.setattr(ws_module, "HANDSHAKE_TIMEOUT_S", 0.2)
    with client.websocket_connect("/ws") as ws:
        _expect_close(ws, 4401)


def test_token_of_an_unknown_user_is_closed_with_4401(client) -> None:
    token = create_access_token(User(id=9999, role=UserRole.CUSTOMER))
    with client.websocket_connect("/ws") as ws:
        _auth(ws, token)
        _expect_close(ws, 4401)


def test_role_comes_from_the_database_not_the_token(client, customer_token) -> None:
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {customer_token}"}).json()
    forged = create_access_token(User(id=me["id"], role=UserRole.ADMIN))
    with client.websocket_connect("/ws") as ws:
        _auth(ws, forged)
        assert ws.receive_json()["user"]["role"] == "customer"


def test_connection_is_registered_and_removed(client, customer_token) -> None:
    with client.websocket_connect("/ws") as ws:
        _auth(ws, customer_token)
        ws.receive_json()
        assert manager._sockets  # noqa: SLF001
    assert not manager._sockets  # noqa: SLF001


def test_unknown_type_and_bad_json_return_errors_and_keep_the_socket(client, customer_token) -> None:
    with client.websocket_connect("/ws") as ws:
        _auth(ws, customer_token)
        ws.receive_json()
        ws.send_json({"type": "nope"})
        assert ws.receive_json()["code"] == "unknown_type"
        ws.send_text("not json")
        assert ws.receive_json()["code"] == "bad_request"
        ws.send_json(["not", "an", "object"])
        assert ws.receive_json()["code"] == "bad_request"


def test_frames_are_dispatched_to_the_registered_handler(client, customer_token, monkeypatch) -> None:
    async def ping(db, user, frame) -> None:
        await manager.send_to_user(user.id, {"type": "pong", "n": frame["n"]})

    monkeypatch.setitem(HANDLERS, "ping", ping)
    with client.websocket_connect("/ws") as ws:
        _auth(ws, customer_token)
        ws.receive_json()
        ws.send_json({"type": "ping", "n": 7})
        assert ws.receive_json() == {"type": "pong", "n": 7}


def test_handler_errors_become_error_events(client, customer_token, monkeypatch) -> None:
    async def boom(db, user, frame) -> None:
        raise WsError("nope", "detalle")

    async def crash(db, user, frame) -> None:
        raise RuntimeError("bug")

    monkeypatch.setitem(HANDLERS, "boom", boom)
    monkeypatch.setitem(HANDLERS, "crash", crash)
    with client.websocket_connect("/ws") as ws:
        _auth(ws, customer_token)
        ws.receive_json()
        ws.send_json({"type": "boom"})
        assert ws.receive_json() == {"type": "error", "code": "nope", "detail": "detalle"}
        ws.send_json({"type": "crash"})
        assert ws.receive_json()["code"] == "internal"


def test_rate_limit_returns_an_error_but_keeps_the_socket(client, customer_token, monkeypatch) -> None:
    monkeypatch.setattr(ws_module, "RATE_LIMIT_FRAMES", 3)
    with client.websocket_connect("/ws") as ws:
        _auth(ws, customer_token)
        ws.receive_json()
        for _ in range(3):
            ws.send_json({"type": "nope"})
            assert ws.receive_json()["code"] == "unknown_type"
        ws.send_json({"type": "nope"})
        assert ws.receive_json()["code"] == "rate_limited"
```

- [ ] **Step 3: Run to verify it fails**

Run: `uv run pytest tests/test_ws.py -q`
Expected: FAIL — `/ws` does not exist (`WebSocketDisconnect`) and `app.api.ws` cannot be imported.

- [ ] **Step 4: Implement** — `ko_back/app/api/ws.py`

```python
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
```

Modify `ko_back/app/main.py`: add `from app.api.ws import router as ws_router` next to the other router imports and `app.include_router(ws_router)` next to the other `include_router` calls.

- [ ] **Step 5: Run to verify it passes**

Run: `uv run pytest -q` — Expected: all pass (existing tests plus 13 new websocket tests).

- [ ] **Step 6: Commit**

```bash
git add ko_back/app/api/ws.py ko_back/app/core/database.py ko_back/app/main.py ko_back/tests/conftest.py ko_back/tests/test_ws.py
git commit -m "feat(backend): add authenticated /ws endpoint with origin check, rate limit and frame dispatch" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

### Task 3: Frontend `RealtimeService`

**Files:**
- Create: `ko_front/src/app/core/models/realtime.model.ts`, `ko_front/src/app/core/services/realtime.service.ts`, `ko_front/src/app/core/services/realtime.service.spec.ts`
- Modify: `ko_front/src/app/app.ts`

**Interfaces:**
- Consumes: `AuthService.currentUser` (signal) and `AuthService.logout()`; `getToken()` from `token-storage`.
- Produces: `ConnectionStatus = 'connecting' | 'open' | 'closed'`; `ServerEvent` (union, extended in later tasks); `WEBSOCKET_FACTORY` token; `RealtimeService` with `status: Signal<ConnectionStatus>`, `events$: Observable<ServerEvent>`, `reconnected$: Observable<void>`, `send(frame: object): boolean`.

- [ ] **Step 1: Write the failing tests** — `ko_front/src/app/core/services/realtime.service.spec.ts`

```ts
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from './auth.service';
import { RealtimeService, WEBSOCKET_FACTORY } from './realtime.service';
import { setToken, clearToken } from './token-storage';
import type { AppUser } from '../models/user.model';
import type { ServerEvent } from '../models/realtime.model';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.onopen?.();
  }
  receive(event: unknown): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  drop(code = 1006): void {
    this.onclose?.({ code });
  }
}

const USER: AppUser = { id: 1, email: 'a@b.c', role: 'customer' };

function setup() {
  FakeWebSocket.instances = [];
  setToken('tok');
  const user = signal<AppUser | undefined>(undefined);
  const auth = { currentUser: user, logout: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: auth },
      { provide: WEBSOCKET_FACTORY, useValue: (url: string) => new FakeWebSocket(url) as unknown as WebSocket },
    ],
  });
  const service = TestBed.inject(RealtimeService);
  const login = () => {
    user.set(USER);
    TestBed.tick();
  };
  return { service, user, auth, login };
}

const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

describe('RealtimeService', () => {
  afterEach(() => {
    vi.useRealTimers();
    clearToken();
  });

  it('does not connect while nobody is logged in', () => {
    setup();
    TestBed.tick();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('connects on login, sends the token as the first frame and becomes open on ready', () => {
    const { service, login } = setup();
    login();
    expect(last().url).toBe('ws://localhost:8000/ws');
    expect(service.status()).toBe('connecting');

    last().open();
    expect(JSON.parse(last().sent[0])).toEqual({ type: 'auth', token: 'tok' });

    last().receive({ type: 'ready', user: { id: 1, role: 'customer' } });
    expect(service.status()).toBe('open');
  });

  it('forwards server events', () => {
    const { service, login } = setup();
    const seen: ServerEvent[] = [];
    service.events$.subscribe(e => seen.push(e));
    login();
    last().open();
    last().receive({ type: 'ready', user: { id: 1, role: 'customer' } });
    last().receive({ type: 'error', code: 'x', detail: 'y' });
    expect(seen.map(e => e.type)).toEqual(['ready', 'error']);
  });

  it('closes the socket on logout', () => {
    const { service, user, login } = setup();
    login();
    const socket = last();
    user.set(undefined);
    TestBed.tick();
    expect(socket.closed).toBe(true);
    expect(service.status()).toBe('closed');
  });

  it('reconnects with exponential backoff and resets it once ready', () => {
    vi.useFakeTimers();
    const { login } = setup();
    login();
    last().drop();
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    last().drop();
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    last().open();
    last().receive({ type: 'ready', user: { id: 1, role: 'customer' } });
    last().drop();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it('caps the backoff at 30 seconds', () => {
    vi.useFakeTimers();
    const { login } = setup();
    login();
    for (let i = 0; i < 8; i++) {
      last().drop();
      vi.advanceTimersByTime(30_000);
    }
    const before = FakeWebSocket.instances.length;
    last().drop();
    vi.advanceTimersByTime(30_000);
    expect(FakeWebSocket.instances).toHaveLength(before + 1);
  });

  it('does not retry after 4401 and logs the user out', () => {
    vi.useFakeTimers();
    const { auth, login } = setup();
    login();
    last().drop(4401);
    vi.advanceTimersByTime(120_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(auth.logout).toHaveBeenCalled();
  });

  it('emits reconnected$ on the second ready, not the first', () => {
    vi.useFakeTimers();
    const { service, login } = setup();
    const reconnected = vi.fn();
    service.reconnected$.subscribe(reconnected);
    login();
    last().open();
    last().receive({ type: 'ready', user: { id: 1, role: 'customer' } });
    expect(reconnected).not.toHaveBeenCalled();

    last().drop();
    vi.advanceTimersByTime(1000);
    last().open();
    last().receive({ type: 'ready', user: { id: 1, role: 'customer' } });
    expect(reconnected).toHaveBeenCalledTimes(1);
  });

  it('send() only writes when the connection is open', () => {
    const { service, login } = setup();
    login();
    expect(service.send({ type: 'chat.send', body: 'hola' })).toBe(false);
    last().open();
    last().receive({ type: 'ready', user: { id: 1, role: 'customer' } });
    expect(service.send({ type: 'chat.send', body: 'hola' })).toBe(true);
    expect(JSON.parse(last().sent[1])).toEqual({ type: 'chat.send', body: 'hola' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run the frontend test command. Expected: FAIL — `realtime.service` cannot be resolved (the 3 known failures are also listed).

- [ ] **Step 3: Implement** — `ko_front/src/app/core/models/realtime.model.ts`

```ts
export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface ReadyEvent {
  type: 'ready';
  user: { id: number; role: 'admin' | 'customer' };
}

export interface ErrorEvent {
  type: 'error';
  code: string;
  detail: string;
}

/** Eventos que envía el servidor. Se amplía en las ramas de chat y pedidos. */
export type ServerEvent = ReadyEvent | ErrorEvent;
```

`ko_front/src/app/core/services/realtime.service.ts`

```ts
import { Injectable, InjectionToken, effect, inject, signal, untracked } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { ConnectionStatus, ServerEvent } from '../models/realtime.model';
import { AuthService } from './auth.service';
import { getToken } from './token-storage';

export type SocketFactory = (url: string) => WebSocket;

export const WEBSOCKET_FACTORY = new InjectionToken<SocketFactory>('WEBSOCKET_FACTORY', {
  providedIn: 'root',
  factory: () => (url: string) => new WebSocket(url),
});

const CLOSE_UNAUTHORIZED = 4401;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

const wsUrl = (): string => `${environment.apiUrl.replace(/^http/, 'ws')}/ws`;

/** Única pieza que toca el WebSocket: autentica, reconecta y reparte los eventos tipados. */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private auth = inject(AuthService);
  private createSocket = inject(WEBSOCKET_FACTORY);

  readonly status = signal<ConnectionStatus>('closed');

  private readonly eventsSubject = new Subject<ServerEvent>();
  private readonly reconnectedSubject = new Subject<void>();
  readonly events$: Observable<ServerEvent> = this.eventsSubject.asObservable();
  /** Se emite al volver a estar listo tras una caída: los consumidores recargan lo que pudieron perder. */
  readonly reconnected$: Observable<void> = this.reconnectedSubject.asObservable();

  private socket: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private hasBeenReady = false;

  constructor() {
    effect(() => {
      const loggedIn = !!this.auth.currentUser();
      untracked(() => (loggedIn ? this.connect() : this.disconnect()));
    });
  }

  /** Devuelve false (y no envía nada) si la conexión no está lista. */
  send(frame: object): boolean {
    if (this.status() !== 'open' || !this.socket) return false;
    this.socket.send(JSON.stringify(frame));
    return true;
  }

  private connect(): void {
    if (this.socket) return;
    const token = getToken();
    if (!token) return;

    this.clearRetry();
    this.status.set('connecting');
    const socket = this.createSocket(wsUrl());
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token }));
    socket.onmessage = message => this.handleMessage(message.data as string);
    socket.onclose = event => this.handleClose(socket, event.code);
  }

  private disconnect(): void {
    this.clearRetry();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
    this.status.set('closed');
    this.attempt = 0;
    this.hasBeenReady = false;
  }

  private handleMessage(data: string): void {
    let event: ServerEvent;
    try {
      event = JSON.parse(data) as ServerEvent;
    } catch {
      return;
    }
    if (event.type === 'ready') {
      this.attempt = 0;
      this.status.set('open');
      if (this.hasBeenReady) this.reconnectedSubject.next();
      this.hasBeenReady = true;
    }
    this.eventsSubject.next(event);
  }

  private handleClose(socket: WebSocket, code: number): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.status.set('closed');
    if (code === CLOSE_UNAUTHORIZED) {
      void this.auth.logout();
      return;
    }
    if (this.auth.currentUser()) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const delay = Math.min(BASE_DELAY_MS * 2 ** this.attempt, MAX_DELAY_MS);
    this.attempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
```

Modify `ko_front/src/app/app.ts`: add `import { inject } from '@angular/core';` (extend the existing `@angular/core` import), `import { RealtimeService } from './core/services/realtime.service';`, and inside the class body:

```ts
export class App {
  // Instanciarlo aquí abre el websocket en cuanto hay sesión.
  private realtime = inject(RealtimeService);
}
```

(Replace the current empty `export class App { }`.)

- [ ] **Step 4: Run to verify it passes**

Run the frontend test command and the build. Expected: "Frontend green" (only the 3 known failures; 9 new tests pass).

- [ ] **Step 5: Commit**

```bash
git add ko_front/src/app/core/models/realtime.model.ts ko_front/src/app/core/services/realtime.service.ts ko_front/src/app/core/services/realtime.service.spec.ts ko_front/src/app/app.ts
git commit -m "feat(frontend): add RealtimeService with token handshake, backoff reconnect and typed events" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

### Task 3b: Verify and merge `feat/ws-core`

- [ ] **Step 1: Full verification** — backend `uv run pytest -q` green; frontend green; restart the API and check it boots (`curl -s localhost:8000/health`).
- [ ] **Step 2: Manual smoke** — with the app open and logged in, browser devtools → Network → WS shows one `/ws` connection with a `ready` frame; log out and it closes.
- [ ] **Step 3: Merge**

```bash
git checkout dev
git merge --no-ff feat/ws-core -m "Merge feat/ws-core into dev" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Ask the user before pushing.

---

## Branch 2 — `feat/chat-backend`

```bash
git checkout dev && git checkout -b feat/chat-backend
```

### Task 4: `ChatMessage` model, migration `0003` and chat service

**Files:**
- Create: `ko_back/app/models/chat.py`, `ko_back/app/schemas/chat.py`, `ko_back/app/services/__init__.py` (empty), `ko_back/app/services/chat.py`, `ko_back/alembic/versions/0003_chat_message.py`, `ko_back/tests/test_chat_service.py`
- Modify: `ko_back/app/models/__init__.py`

**Interfaces:**
- Produces (`app.services.chat`): `MAX_BODY_LENGTH = 1000`; `normalize_body(value: object) -> str` (raises `ValueError`); `is_customer(db, user_id) -> bool`; `add_message(db, customer_id, sender_id, body) -> ChatMessage`; `mark_read(db, customer_id, reader_role: UserRole) -> None`; `list_messages(db, customer_id, limit=50, before_id=None) -> list[ChatMessage]` (oldest→newest); `list_threads(db) -> list[ChatThreadResponse]`; `to_response(message) -> ChatMessageResponse`.
- Produces (`app.schemas.chat`): `ChatMessageResponse(id, customer_id, sender_id, sender_role, body, created_at, read_at)`, `ChatThreadResponse(customer_id, customer_email, last_message, unread_count)`.

- [ ] **Step 1: Write the failing tests** — `ko_back/tests/test_chat_service.py`

```python
import pytest

from app.models.chat import ChatMessage
from app.models.user import User, UserRole
from app.services import chat


def _user(db, email: str, role: UserRole = UserRole.CUSTOMER) -> User:
    user = User(email=email, hashed_password="x", role=role)
    db.add(user)
    db.commit()
    return user


@pytest.fixture
def people(db_session):
    return {
        "ana": _user(db_session, "ana@test.com"),
        "bea": _user(db_session, "bea@test.com"),
        "admin": _user(db_session, "admin@test.com", UserRole.ADMIN),
    }


def test_normalize_body_trims_and_validates() -> None:
    assert chat.normalize_body("  hola  ") == "hola"
    for bad in ["", "   ", None, 5, "x" * 1001]:
        with pytest.raises(ValueError):
            chat.normalize_body(bad)
    assert chat.normalize_body("x" * 1000) == "x" * 1000


def test_is_customer(db_session, people) -> None:
    assert chat.is_customer(db_session, people["ana"].id)
    assert not chat.is_customer(db_session, people["admin"].id)
    assert not chat.is_customer(db_session, 9999)


def test_add_message_persists_and_reports_sender_role(db_session, people) -> None:
    message = chat.add_message(db_session, people["ana"].id, people["admin"].id, "hola")
    response = chat.to_response(message)
    assert response.sender_role == "admin"
    assert response.customer_id == people["ana"].id
    assert response.read_at is None


def test_list_messages_is_oldest_first_and_paginates(db_session, people) -> None:
    ids = [chat.add_message(db_session, people["ana"].id, people["ana"].id, f"m{i}").id for i in range(5)]
    chat.add_message(db_session, people["bea"].id, people["bea"].id, "otra")

    latest = chat.list_messages(db_session, people["ana"].id, limit=3)
    assert [m.body for m in latest] == ["m2", "m3", "m4"]

    older = chat.list_messages(db_session, people["ana"].id, limit=3, before_id=latest[0].id)
    assert [m.body for m in older] == ["m0", "m1"]
    assert older[0].id == ids[0]


def test_admin_reading_marks_only_the_customers_messages(db_session, people) -> None:
    from_customer = chat.add_message(db_session, people["ana"].id, people["ana"].id, "duda")
    from_admin = chat.add_message(db_session, people["ana"].id, people["admin"].id, "respuesta")

    chat.mark_read(db_session, people["ana"].id, UserRole.ADMIN)
    db_session.expire_all()

    assert db_session.get(ChatMessage, from_customer.id).read_at is not None
    assert db_session.get(ChatMessage, from_admin.id).read_at is None


def test_customer_reading_marks_only_the_admins_messages(db_session, people) -> None:
    from_customer = chat.add_message(db_session, people["ana"].id, people["ana"].id, "duda")
    from_admin = chat.add_message(db_session, people["ana"].id, people["admin"].id, "respuesta")

    chat.mark_read(db_session, people["ana"].id, UserRole.CUSTOMER)
    db_session.expire_all()

    assert db_session.get(ChatMessage, from_admin.id).read_at is not None
    assert db_session.get(ChatMessage, from_customer.id).read_at is None


def test_list_threads_orders_by_latest_activity_and_counts_unread(db_session, people) -> None:
    chat.add_message(db_session, people["ana"].id, people["ana"].id, "a1")
    chat.add_message(db_session, people["ana"].id, people["ana"].id, "a2")
    chat.add_message(db_session, people["bea"].id, people["bea"].id, "b1")
    chat.add_message(db_session, people["ana"].id, people["admin"].id, "respuesta a ana")

    threads = chat.list_threads(db_session)

    assert [t.customer_email for t in threads] == ["ana@test.com", "bea@test.com"]
    assert threads[0].last_message.body == "respuesta a ana"
    assert threads[0].unread_count == 2  # solo cuentan los mensajes del cliente
    assert threads[1].unread_count == 1


def test_list_threads_is_empty_without_messages(db_session) -> None:
    assert chat.list_threads(db_session) == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_chat_service.py -q` — Expected: FAIL — `app.models.chat` / `app.services` not found.

- [ ] **Step 3: Implement** — `ko_back/app/models/chat.py`

```python
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
```

`ko_back/app/models/__init__.py` — add `from app.models.chat import ChatMessage` and `"ChatMessage"` to `__all__`.

`ko_back/app/schemas/chat.py`

```python
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
```

`ko_back/app/services/chat.py`

```python
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
```

`ko_back/alembic/versions/0003_chat_message.py`

```python
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_message",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("sender_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("read_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_chat_message_customer_id_id", "chat_message", ["customer_id", "id"])


def downgrade() -> None:
    op.drop_index("ix_chat_message_customer_id_id", table_name="chat_message")
    op.drop_table("chat_message")
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest -q` — Expected: all pass (8 new tests).

- [ ] **Step 5: Apply the migration to the dev database**

Run: `uv run alembic upgrade head` — Expected: `Running upgrade 0002 -> 0003`.

- [ ] **Step 6: Commit**

```bash
git add ko_back/app/models ko_back/app/schemas/chat.py ko_back/app/services ko_back/alembic/versions/0003_chat_message.py ko_back/tests/test_chat_service.py
git commit -m "feat(backend): add ChatMessage model, migration 0003 and chat service" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

### Task 5: Chat REST endpoints

**Files:**
- Create: `ko_back/app/api/chat.py`, `ko_back/tests/test_chat_api.py`
- Modify: `ko_back/app/main.py`

**Interfaces:**
- Consumes: `app.services.chat` (`list_messages`, `list_threads`, `is_customer`, `to_response`) from Task 4; `get_current_user`, `require_admin`.
- Produces: `GET /chat/messages`, `GET /chat/threads`, `GET /chat/threads/{customer_id}/messages`.

- [ ] **Step 1: Write the failing tests** — `ko_back/tests/test_chat_api.py`

```python
from app.services import chat


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _me(client, token: str) -> int:
    return client.get("/auth/me", headers=_auth(token)).json()["id"]


def test_customer_reads_only_their_own_thread(client, db_session, customer_token) -> None:
    me = _me(client, customer_token)
    other = client.post("/auth/register", json={"email": "otra@test.com", "password": "secret123"}).json()
    other_id = _me(client, other["access_token"])
    chat.add_message(db_session, me, me, "mío")
    chat.add_message(db_session, other_id, other_id, "ajeno")

    response = client.get("/chat/messages", headers=_auth(customer_token))

    assert response.status_code == 200
    assert [m["body"] for m in response.json()] == ["mío"]
    assert response.json()[0]["sender_role"] == "customer"


def test_customer_messages_paginate(client, db_session, customer_token) -> None:
    me = _me(client, customer_token)
    for i in range(5):
        chat.add_message(db_session, me, me, f"m{i}")

    page = client.get("/chat/messages?limit=2", headers=_auth(customer_token)).json()
    assert [m["body"] for m in page] == ["m3", "m4"]
    older = client.get(f"/chat/messages?limit=2&before_id={page[0]['id']}", headers=_auth(customer_token)).json()
    assert [m["body"] for m in older] == ["m1", "m2"]


def test_admin_cannot_use_the_customer_endpoint(client, admin_token) -> None:
    assert client.get("/chat/messages", headers=_auth(admin_token)).status_code == 403


def test_anonymous_gets_401(client) -> None:
    assert client.get("/chat/messages").status_code == 401
    assert client.get("/chat/threads").status_code == 401


def test_admin_lists_threads_with_unread_counts(client, db_session, admin_token, customer_token) -> None:
    me = _me(client, customer_token)
    chat.add_message(db_session, me, me, "hola")

    response = client.get("/chat/threads", headers=_auth(admin_token))

    assert response.status_code == 200
    [thread] = response.json()
    assert thread["customer_email"] == "cliente@test.com"
    assert thread["unread_count"] == 1
    assert thread["last_message"]["body"] == "hola"


def test_customer_cannot_list_threads(client, customer_token) -> None:
    assert client.get("/chat/threads", headers=_auth(customer_token)).status_code == 403


def test_admin_reads_a_customers_thread(client, db_session, admin_token, customer_token) -> None:
    me = _me(client, customer_token)
    chat.add_message(db_session, me, me, "hola")

    response = client.get(f"/chat/threads/{me}/messages", headers=_auth(admin_token))

    assert response.status_code == 200
    assert [m["body"] for m in response.json()] == ["hola"]


def test_admin_thread_of_a_non_customer_is_404(client, admin_token) -> None:
    assert client.get("/chat/threads/9999/messages", headers=_auth(admin_token)).status_code == 404


def test_customer_cannot_read_a_thread_by_id(client, customer_token) -> None:
    me = _me(client, customer_token)
    assert client.get(f"/chat/threads/{me}/messages", headers=_auth(customer_token)).status_code == 403
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_chat_api.py -q` — Expected: FAIL — 404 on `/chat/...`.

- [ ] **Step 3: Implement** — `ko_back/app/api/chat.py`

```python
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
```

Modify `ko_back/app/main.py`: add `from app.api.chat import router as chat_router` and `app.include_router(chat_router)`.

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest -q` — Expected: all pass (9 new tests).

- [ ] **Step 5: Commit**

```bash
git add ko_back/app/api/chat.py ko_back/app/main.py ko_back/tests/test_chat_api.py
git commit -m "feat(backend): add chat REST endpoints for customer history and admin threads" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

### Task 6: `chat.send` / `chat.read` websocket handlers

**Files:**
- Create: `ko_back/app/api/ws_chat.py`, `ko_back/tests/test_ws_chat.py`
- Modify: `ko_back/app/api/ws.py`

**Interfaces:**
- Consumes: `register`, `WsError`, `WsUser`, `manager` (Task 1); `chat_service` (Task 4).
- Produces: frame `chat.send {body, customer_id?}` → event `chat.message {message}` to the thread's customer and all admins; frame `chat.read {customer_id?}` → event `chat.read {customer_id, reader_role}` to the same recipients.

- [ ] **Step 1: Write the failing tests** — `ko_back/tests/test_ws_chat.py`

```python
from contextlib import contextmanager

from app.models.chat import ChatMessage


@contextmanager
def connect(client, token: str):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": token})
        assert ws.receive_json()["type"] == "ready"
        yield ws


def _register(client, email: str) -> str:
    return client.post("/auth/register", json={"email": email, "password": "secret123"}).json()["access_token"]


def _me(client, token: str) -> int:
    return client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).json()["id"]


def test_customer_message_reaches_the_customer_and_every_admin_and_is_saved(
    client, db_session, customer_token, admin_token
) -> None:
    with connect(client, customer_token) as customer, connect(client, admin_token) as admin:
        customer.send_json({"type": "chat.send", "body": "  ¿Tenéis mochis sin gluten?  "})
        mine = customer.receive_json()
        theirs = admin.receive_json()

    for event in (mine, theirs):
        assert event["type"] == "chat.message"
        assert event["message"]["body"] == "¿Tenéis mochis sin gluten?"
        assert event["message"]["sender_role"] == "customer"
        assert event["message"]["read_at"] is None
    db_session.expire_all()
    assert db_session.query(ChatMessage).count() == 1


def test_customers_always_write_to_their_own_thread(client, db_session, customer_token) -> None:
    other_id = _me(client, _register(client, "otra@test.com"))
    me = _me(client, customer_token)

    with connect(client, customer_token) as customer:
        customer.send_json({"type": "chat.send", "body": "hola", "customer_id": other_id})
        assert customer.receive_json()["message"]["customer_id"] == me


def test_admin_reply_reaches_only_that_customer(client, admin_token, customer_token) -> None:
    other_token = _register(client, "otra@test.com")
    me = _me(client, customer_token)

    with connect(client, admin_token) as admin, connect(client, customer_token) as customer, connect(
        client, other_token
    ) as other:
        admin.send_json({"type": "chat.send", "body": "para ti", "customer_id": me})
        assert admin.receive_json()["message"]["sender_role"] == "admin"
        reply = customer.receive_json()
        assert reply["message"]["body"] == "para ti"

        # Si el mensaje anterior se hubiese filtrado a `other`, llegaría antes que este.
        admin.send_json({"type": "chat.send", "body": "para otra", "customer_id": _me(client, other_token)})
        admin.receive_json()
        assert other.receive_json()["message"]["body"] == "para otra"


def test_admin_needs_a_valid_customer_id(client, admin_token, customer_token) -> None:
    with connect(client, admin_token) as admin:
        admin.send_json({"type": "chat.send", "body": "hola"})
        assert admin.receive_json()["code"] == "bad_request"
        admin.send_json({"type": "chat.send", "body": "hola", "customer_id": 9999})
        assert admin.receive_json()["code"] == "bad_request"
        admin.send_json({"type": "chat.send", "body": "hola", "customer_id": True})
        assert admin.receive_json()["code"] == "bad_request"


def test_invalid_bodies_are_rejected(client, db_session, customer_token) -> None:
    with connect(client, customer_token) as customer:
        for bad in ["", "   ", "x" * 1001, 5, None]:
            customer.send_json({"type": "chat.send", "body": bad})
            assert customer.receive_json()["code"] == "bad_request"
    db_session.expire_all()
    assert db_session.query(ChatMessage).count() == 0


def test_message_to_an_offline_admin_is_kept_and_shows_as_unread(client, customer_token, admin_token) -> None:
    with connect(client, customer_token) as customer:
        customer.send_json({"type": "chat.send", "body": "¿Abrís hoy?"})
        customer.receive_json()

    threads = client.get("/chat/threads", headers={"Authorization": f"Bearer {admin_token}"}).json()
    assert threads[0]["unread_count"] == 1
    assert threads[0]["last_message"]["body"] == "¿Abrís hoy?"


def test_admin_read_notifies_both_sides_and_clears_unread(client, db_session, customer_token, admin_token) -> None:
    me = _me(client, customer_token)
    with connect(client, customer_token) as customer, connect(client, admin_token) as admin:
        customer.send_json({"type": "chat.send", "body": "hola"})
        customer.receive_json()
        admin.receive_json()

        admin.send_json({"type": "chat.read", "customer_id": me})
        for ws in (admin, customer):
            event = ws.receive_json()
            assert event == {"type": "chat.read", "customer_id": me, "reader_role": "admin"}

    threads = client.get("/chat/threads", headers={"Authorization": f"Bearer {admin_token}"}).json()
    assert threads[0]["unread_count"] == 0


def test_customer_read_marks_the_admins_messages(client, db_session, customer_token, admin_token) -> None:
    me = _me(client, customer_token)
    with connect(client, admin_token) as admin, connect(client, customer_token) as customer:
        admin.send_json({"type": "chat.send", "body": "respuesta", "customer_id": me})
        admin.receive_json()
        customer.receive_json()

        customer.send_json({"type": "chat.read"})
        assert customer.receive_json()["reader_role"] == "customer"

    db_session.expire_all()
    assert db_session.query(ChatMessage).one().read_at is not None
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_ws_chat.py -q` — Expected: FAIL — `unknown_type` for `chat.send` / `chat.read`.

- [ ] **Step 3: Implement** — `ko_back/app/api/ws_chat.py`

```python
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
```

Modify `ko_back/app/api/ws.py`: after the `from app.core...` imports add

```python
from app.api import ws_chat  # noqa: F401  (registra los handlers de chat)
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest -q` — Expected: all pass (8 new tests).

- [ ] **Step 5: Commit**

```bash
git add ko_back/app/api/ws_chat.py ko_back/app/api/ws.py ko_back/tests/test_ws_chat.py
git commit -m "feat(backend): handle chat.send and chat.read over the websocket" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

### Task 6b: Verify and merge `feat/chat-backend`

- [ ] **Step 1:** `uv run pytest -q` green; restart the API; `uv run alembic current` shows `0003`.
- [ ] **Step 2: Merge**

```bash
git checkout dev
git merge --no-ff feat/chat-backend -m "Merge feat/chat-backend into dev" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Ask the user before pushing.

---

## Branch 3 — `feat/chat-widget`

```bash
git checkout dev && git checkout -b feat/chat-widget
```

### Task 7: Chat models and customer-side `ChatService`

**Files:**
- Create: `ko_front/src/app/core/models/chat.model.ts`, `ko_front/src/app/core/services/chat.service.ts`, `ko_front/src/app/core/services/chat.service.spec.ts`
- Modify: `ko_front/src/app/core/models/realtime.model.ts`

**Interfaces:**
- Consumes: `RealtimeService.status`, `.events$`, `.reconnected$`, `.send(frame)` (Task 3); `AuthService.currentUser`.
- Produces: `ChatMessage`, `ChatMessageApi`, `ChatRole`, `ChatThread`, `ChatThreadApi`; `messageFromApi`, `threadFromApi`; `ChatService` with `canSend`, `loadError`, `customerMessages`, `customerUnread`, `loadCustomerThread()`, `send(body): boolean`, `markRead(): void`. (Task 9 adds the admin side and replaces this file.)

- [ ] **Step 1: Write the failing tests** — `ko_front/src/app/core/services/chat.service.spec.ts`

```ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { RealtimeService } from './realtime.service';
import { ChatService } from './chat.service';
import type { AppUser } from '../models/user.model';
import type { ChatMessageApi } from '../models/chat.model';
import type { ServerEvent } from '../models/realtime.model';

class FakeRealtime {
  status = signal<'open' | 'connecting' | 'closed'>('open');
  events = new Subject<ServerEvent>();
  reconnected = new Subject<void>();
  events$ = this.events.asObservable();
  reconnected$ = this.reconnected.asObservable();
  send = vi.fn().mockReturnValue(true);
}

const api = (over: Partial<ChatMessageApi> = {}): ChatMessageApi => ({
  id: 1,
  customer_id: 5,
  sender_id: 5,
  sender_role: 'customer',
  body: 'hola',
  created_at: '2026-09-21T10:00:00',
  read_at: null,
  ...over,
});

const messagesUrl = `${environment.apiUrl}/chat/messages`;

function setup(role: AppUser['role'] | undefined = 'customer') {
  const user = signal<AppUser | undefined>(role ? { id: 5, email: 'c@x.com', role } : undefined);
  const realtime = new FakeRealtime();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { currentUser: user } },
      { provide: RealtimeService, useValue: realtime },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const service = TestBed.inject(ChatService);
  TestBed.tick();
  return { service, http, realtime, user };
}

async function loaded(rows: ChatMessageApi[]) {
  const ctx = setup();
  ctx.http.expectOne(r => r.url === messagesUrl).flush(rows);
  await vi.waitFor(() => expect(ctx.service.customerMessages()).toHaveLength(rows.length));
  return ctx;
}

describe('ChatService (customer)', () => {
  it('loads the customer thread on login', async () => {
    const { service } = await loaded([api({ id: 1 }), api({ id: 2, sender_id: 1, sender_role: 'admin', body: 'hola!' })]);
    expect(service.customerMessages().map(m => m.body)).toEqual(['hola', 'hola!']);
    expect(service.customerMessages()[1].senderRole).toBe('admin');
  });

  it('does not load anything without a user', () => {
    const { http } = setup(undefined);
    http.expectNone(r => r.url === messagesUrl);
  });

  it('appends live messages for its own thread and ignores duplicates', async () => {
    const { service, realtime } = await loaded([api({ id: 1 })]);
    const event: ServerEvent = { type: 'chat.message', message: api({ id: 2, sender_role: 'admin', sender_id: 1 }) };
    realtime.events.next(event);
    realtime.events.next(event);
    expect(service.customerMessages().map(m => m.id)).toEqual([1, 2]);
  });

  it('ignores messages of another thread', async () => {
    const { service, realtime } = await loaded([api({ id: 1 })]);
    realtime.events.next({ type: 'chat.message', message: api({ id: 9, customer_id: 77 }) });
    expect(service.customerMessages()).toHaveLength(1);
  });

  it('counts unread admin messages until the customer reads them', async () => {
    const { service, realtime } = await loaded([api({ id: 1 }), api({ id: 2, sender_id: 1, sender_role: 'admin' })]);
    expect(service.customerUnread()).toBe(1);
    realtime.events.next({ type: 'chat.read', customer_id: 5, reader_role: 'customer' });
    expect(service.customerUnread()).toBe(0);
  });

  it('markRead() only sends when there is something unread', async () => {
    const { service, realtime } = await loaded([api({ id: 1 })]);
    service.markRead();
    expect(realtime.send).not.toHaveBeenCalled();

    realtime.events.next({ type: 'chat.message', message: api({ id: 2, sender_id: 1, sender_role: 'admin' }) });
    service.markRead();
    expect(realtime.send).toHaveBeenCalledWith({ type: 'chat.read' });
  });

  it('send() forwards to the socket and reports failure when it is not open', async () => {
    const { service, realtime } = await loaded([]);
    expect(service.send('hola')).toBe(true);
    expect(realtime.send).toHaveBeenCalledWith({ type: 'chat.send', body: 'hola' });

    realtime.send.mockReturnValue(false);
    expect(service.send('otra')).toBe(false);
  });

  it('canSend follows the connection status', async () => {
    const { service, realtime } = await loaded([]);
    expect(service.canSend()).toBe(true);
    realtime.status.set('closed');
    expect(service.canSend()).toBe(false);
  });

  it('reloads the thread after a reconnection', async () => {
    const { service, http, realtime } = await loaded([api({ id: 1 })]);
    realtime.reconnected.next();
    http.expectOne(r => r.url === messagesUrl).flush([api({ id: 1 }), api({ id: 2 })]);
    await vi.waitFor(() => expect(service.customerMessages()).toHaveLength(2));
  });

  it('keeps what it had and reports an error when loading fails', async () => {
    const { service, http, realtime } = await loaded([api({ id: 1 })]);
    realtime.reconnected.next();
    http.expectOne(r => r.url === messagesUrl).flush('boom', { status: 500, statusText: 'Server Error' });
    await vi.waitFor(() => expect(service.loadError()).not.toBe(''));
    expect(service.customerMessages()).toHaveLength(1);
  });

  it('clears the thread on logout', async () => {
    const { service, user } = await loaded([api({ id: 1 })]);
    user.set(undefined);
    TestBed.tick();
    expect(service.customerMessages()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run the frontend test command. Expected: FAIL — `chat.service` / `chat.model` not found.

- [ ] **Step 3: Implement** — `ko_front/src/app/core/models/chat.model.ts`

```ts
export type ChatRole = 'admin' | 'customer';

/** Forma del servidor (snake_case). */
export interface ChatMessageApi {
  id: number;
  customer_id: number;
  sender_id: number;
  sender_role: ChatRole;
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface ChatThreadApi {
  customer_id: number;
  customer_email: string;
  last_message: ChatMessageApi;
  unread_count: number;
}

export interface ChatMessage {
  id: number;
  customerId: number;
  senderId: number;
  senderRole: ChatRole;
  body: string;
  createdAt: number;
  readAt: number | null;
}

export interface ChatThread {
  customerId: number;
  customerEmail: string;
  lastMessage: ChatMessage;
  unreadCount: number;
}
```

Modify `ko_front/src/app/core/models/realtime.model.ts` — add the chat events and extend the union:

```ts
import type { ChatMessageApi, ChatRole } from './chat.model';

export interface ChatMessageEvent {
  type: 'chat.message';
  message: ChatMessageApi;
}

export interface ChatReadEvent {
  type: 'chat.read';
  customer_id: number;
  reader_role: ChatRole;
}

export type ServerEvent = ReadyEvent | ErrorEvent | ChatMessageEvent | ChatReadEvent;
```

(Put the `import` at the top of the file, add the two interfaces above the union, and replace the previous `ServerEvent` line with the one above.)

`ko_front/src/app/core/services/chat.service.ts`

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { ChatMessage, ChatMessageApi, ChatRole } from '../models/chat.model';
import type { ServerEvent } from '../models/realtime.model';
import type { AppUser } from '../models/user.model';
import { AuthService } from './auth.service';
import { RealtimeService } from './realtime.service';

const API = `${environment.apiUrl}/chat`;
const PAGE_SIZE = 50;

export function messageFromApi(m: ChatMessageApi): ChatMessage {
  return {
    id: m.id,
    customerId: m.customer_id,
    senderId: m.sender_id,
    senderRole: m.sender_role,
    body: m.body,
    createdAt: Date.parse(m.created_at),
    readAt: m.read_at ? Date.parse(m.read_at) : null,
  };
}

function upsert(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return list.some(m => m.id === message.id) ? list.map(m => (m.id === message.id ? message : m)) : [...list, message];
}

/** Marca como leídos los mensajes que lee `readerRole` (los del otro lado). */
function withRead(list: ChatMessage[], readerRole: ChatRole): ChatMessage[] {
  const target: ChatRole = readerRole === 'admin' ? 'customer' : 'admin';
  const now = Date.now();
  return list.map(m => (m.senderRole === target && m.readAt === null ? { ...m, readAt: now } : m));
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private realtime = inject(RealtimeService);

  readonly canSend = computed(() => this.realtime.status() === 'open');
  readonly loadError = signal('');

  readonly customerMessages = signal<ChatMessage[]>([]);
  readonly customerUnread = computed(
    () => this.customerMessages().filter(m => m.senderRole === 'admin' && m.readAt === null).length
  );

  constructor() {
    effect(() => {
      const role = this.auth.currentUser()?.role;
      untracked(() => {
        this.customerMessages.set([]);
        this.loadError.set('');
        void this.load(role);
      });
    });
    this.realtime.events$.subscribe(event => this.onEvent(event));
    this.realtime.reconnected$.subscribe(() => void this.load(this.auth.currentUser()?.role));
  }

  async loadCustomerThread(): Promise<void> {
    const rows = await firstValueFrom(this.http.get<ChatMessageApi[]>(`${API}/messages`, { params: { limit: PAGE_SIZE } }));
    this.customerMessages.set(rows.map(messageFromApi));
  }

  /** Devuelve false si no se pudo enviar (conexión caída): el mensaje no se encola. */
  send(body: string): boolean {
    return this.realtime.send({ type: 'chat.send', body });
  }

  markRead(): void {
    if (this.customerUnread() > 0) this.realtime.send({ type: 'chat.read' });
  }

  private async load(role: AppUser['role'] | undefined): Promise<void> {
    try {
      if (role === 'customer') await this.loadCustomerThread();
      this.loadError.set('');
    } catch {
      this.loadError.set('No se pudo cargar el chat. Se reintentará al reconectar.');
    }
  }

  private onEvent(event: ServerEvent): void {
    const user = this.auth.currentUser();
    if (!user || user.role !== 'customer') return;
    if (event.type === 'chat.message') {
      const message = messageFromApi(event.message);
      if (message.customerId === user.id) this.customerMessages.update(list => upsert(list, message));
    } else if (event.type === 'chat.read' && event.customer_id === user.id) {
      this.customerMessages.update(list => withRead(list, event.reader_role));
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run the frontend test command and the build. Expected: "Frontend green" (11 new tests pass).

- [ ] **Step 5: Commit**

```bash
git add ko_front/src/app/core/models ko_front/src/app/core/services/chat.service.ts ko_front/src/app/core/services/chat.service.spec.ts
git commit -m "feat(frontend): add customer-side ChatService with live messages and unread tracking" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

### Task 8: Floating help chat widget

**Files:**
- Create: `ko_front/src/app/shared/components/chat-widget/chat-widget.ts`, `.html`, `.scss`, `chat-widget.spec.ts`
- Modify: `ko_front/src/app/app.ts`

**Interfaces:**
- Consumes: `ChatService` (`customerMessages`, `customerUnread`, `canSend`, `loadError`, `send`, `markRead`); `AuthService.currentUser`.
- Produces: `<app-chat-widget />` (`ChatWidgetComponent`), visible only for logged-in customers.

- [ ] **Step 1: Write the failing tests** — `ko_front/src/app/shared/components/chat-widget/chat-widget.spec.ts`

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { ChatService } from '../../../core/services/chat.service';
import { ChatWidgetComponent } from './chat-widget';
import type { AppUser } from '../../../core/models/user.model';
import type { ChatMessage } from '../../../core/models/chat.model';

class FakeChat {
  customerMessages = signal<ChatMessage[]>([]);
  customerUnread = signal(0);
  canSend = signal(true);
  loadError = signal('');
  send = vi.fn().mockReturnValue(true);
  markRead = vi.fn();
}

const message = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 1,
  customerId: 5,
  senderId: 5,
  senderRole: 'customer',
  body: 'hola',
  createdAt: Date.parse('2026-09-21T10:00:00'),
  readAt: null,
  ...over,
});

describe('ChatWidgetComponent', () => {
  let fixture: ComponentFixture<ChatWidgetComponent>;
  let user: ReturnType<typeof signal<AppUser | undefined>>;
  let chat: FakeChat;
  const el = (selector: string) => fixture.nativeElement.querySelector(selector) as HTMLElement | null;

  beforeEach(async () => {
    user = signal<AppUser | undefined>({ id: 5, email: 'c@x.com', role: 'customer' });
    chat = new FakeChat();
    await TestBed.configureTestingModule({
      imports: [ChatWidgetComponent],
      providers: [
        { provide: AuthService, useValue: { currentUser: user } },
        { provide: ChatService, useValue: chat },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ChatWidgetComponent);
    fixture.detectChanges();
  });

  const open = () => {
    el('.chat__fab')!.click();
    fixture.detectChanges();
  };

  it('shows the help button to customers', () => {
    expect(el('.chat__fab')?.textContent).toContain('¿Necesitas ayuda?');
  });

  it('is hidden for admins and for logged-out users', () => {
    user.set({ id: 1, email: 'a@x.com', role: 'admin' });
    fixture.detectChanges();
    expect(el('.chat__fab')).toBeNull();
    user.set(undefined);
    fixture.detectChanges();
    expect(el('.chat')).toBeNull();
  });

  it('opens the panel, and closes it with the close button and with Escape', () => {
    open();
    expect(el('.chat__panel')).not.toBeNull();
    el('.chat__close')!.click();
    fixture.detectChanges();
    expect(el('.chat__panel')).toBeNull();

    open();
    el('.chat__panel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(el('.chat__panel')).toBeNull();
  });

  it('shows an unread badge only while the panel is closed', () => {
    chat.customerUnread.set(2);
    fixture.detectChanges();
    expect(el('.chat__badge')?.textContent?.trim()).toBe('2');
    open();
    expect(el('.chat__fab .chat__badge')).toBeNull();
  });

  it('marks messages as read when the panel is open and there is something unread', () => {
    chat.customerUnread.set(1);
    fixture.detectChanges();
    expect(chat.markRead).not.toHaveBeenCalled();
    open();
    expect(chat.markRead).toHaveBeenCalled();
  });

  it('renders messages as text, distinguishing who wrote them', () => {
    chat.customerMessages.set([
      message({ id: 1, body: '<b>hola</b>' }),
      message({ id: 2, senderRole: 'admin', senderId: 1, body: 'buenas' }),
    ]);
    open();
    const items = fixture.nativeElement.querySelectorAll('.chat__msg');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('<b>hola</b>');
    expect(items[0].querySelector('b')).toBeNull();
    expect(items[0].classList).toContain('chat__msg--mine');
    expect(items[1].classList).not.toContain('chat__msg--mine');
  });

  it('sends the trimmed draft and clears it', () => {
    open();
    const textarea = el('.chat__input') as HTMLTextAreaElement;
    textarea.value = '  ¿Tenéis tartas?  ';
    textarea.dispatchEvent(new Event('input'));
    (el('.chat__form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    expect(chat.send).toHaveBeenCalledWith('¿Tenéis tartas?');
    fixture.detectChanges();
    expect((el('.chat__input') as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps the draft when the message could not be sent', () => {
    chat.send.mockReturnValue(false);
    open();
    const textarea = el('.chat__input') as HTMLTextAreaElement;
    textarea.value = 'hola';
    textarea.dispatchEvent(new Event('input'));
    (el('.chat__form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(textarea.value).toBe('hola');
  });

  it('does not send empty drafts', () => {
    open();
    (el('.chat__form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    expect(chat.send).not.toHaveBeenCalled();
  });

  it('disables sending and shows a notice while the connection is down', () => {
    chat.canSend.set(false);
    open();
    expect(el('.chat__offline')?.textContent).toContain('Reconectando');
    expect((el('.chat__send') as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run the frontend test command. Expected: FAIL — `chat-widget` not found.

- [ ] **Step 3: Implement** — `ko_front/src/app/shared/components/chat-widget/chat-widget.ts`

```ts
import { DatePipe } from '@angular/common';
import { Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { LucideAngularModule, MessageCircle, Send, X } from 'lucide-angular';
import { AuthService } from '../../../core/services/auth.service';
import { ChatService } from '../../../core/services/chat.service';

@Component({
  selector: 'app-chat-widget',
  standalone: true,
  imports: [DatePipe, LucideAngularModule],
  templateUrl: './chat-widget.html',
  styleUrl: './chat-widget.scss',
})
export class ChatWidgetComponent {
  private auth = inject(AuthService);
  chat = inject(ChatService);

  readonly MessageCircle = MessageCircle;
  readonly Send = Send;
  readonly X = X;

  visible = computed(() => this.auth.currentUser()?.role === 'customer');
  open = signal(false);
  draft = signal('');
  private list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    // Con el panel abierto, lo que llega se da por leído.
    effect(() => {
      if (this.open() && this.chat.customerUnread() > 0) untracked(() => this.chat.markRead());
    });
    // Siempre al último mensaje.
    effect(() => {
      this.chat.customerMessages();
      const el = this.list()?.nativeElement;
      if (el) setTimeout(() => (el.scrollTop = el.scrollHeight));
    });
  }

  toggle(): void {
    this.open.update(v => !v);
  }

  close(): void {
    this.open.set(false);
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    this.submit();
  }

  onEnter(event: Event): void {
    if ((event as KeyboardEvent).shiftKey) return;
    event.preventDefault();
    this.submit();
  }

  private submit(): void {
    const body = this.draft().trim();
    if (!body || !this.chat.canSend()) return;
    if (this.chat.send(body)) this.draft.set('');
  }
}
```

`chat-widget.html`

```html
@if (visible()) {
<div class="chat">
  @if (open()) {
  <section class="chat__panel" role="dialog" aria-label="Chat de ayuda" (keydown.escape)="close()">
    <header class="chat__header">
      <h2>Ayuda</h2>
      <button type="button" class="chat__close" (click)="close()" aria-label="Cerrar chat">
        <lucide-icon [name]="X" [size]="16" aria-hidden="true" />
      </button>
    </header>

    <div #list class="chat__list" role="log" aria-live="polite" aria-label="Mensajes">
      @if (chat.loadError()) {
      <p class="chat__note chat__note--error">{{ chat.loadError() }}</p>
      }
      @if (chat.customerMessages().length === 0) {
      <p class="chat__note">Escríbenos tu duda y te responderemos en cuanto podamos.</p>
      }
      @for (m of chat.customerMessages(); track m.id) {
      <div class="chat__msg" [class.chat__msg--mine]="m.senderRole === 'customer'">
        <p>{{ m.body }}</p>
        <time>{{ m.createdAt | date:'HH:mm' }}</time>
      </div>
      }
    </div>

    @if (!chat.canSend()) {
    <p class="chat__offline" role="status">Reconectando…</p>
    }

    <form class="chat__form" (submit)="onSubmit($event)">
      <textarea class="chat__input" rows="1" maxlength="1000" placeholder="Escribe tu mensaje"
        aria-label="Mensaje" [value]="draft()" (input)="draft.set($any($event.target).value)"
        (keydown.enter)="onEnter($event)"></textarea>
      <button type="submit" class="chat__send" [disabled]="!chat.canSend()" aria-label="Enviar mensaje">
        <lucide-icon [name]="Send" [size]="16" aria-hidden="true" />
      </button>
    </form>
  </section>
  }

  <button type="button" class="chat__fab" (click)="toggle()" [attr.aria-expanded]="open()"
    aria-label="Abrir el chat de ayuda">
    <lucide-icon [name]="MessageCircle" [size]="18" aria-hidden="true" />
    <span>¿Necesitas ayuda?</span>
    @if (!open() && chat.customerUnread() > 0) {
    <span class="chat__badge">{{ chat.customerUnread() }}</span>
    }
  </button>
</div>
}
```

`chat-widget.scss`

```scss
@use '../../../../styles/variables' as *;
@use '../../../../styles/mixins' as *;

.chat {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 80;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 14px;
}

.chat__fab {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 22px;
  border: 0;
  border-radius: $radius-pill;
  background: $text-dark;
  color: $cream;
  cursor: pointer;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  box-shadow: 0 8px 24px rgba(74, 63, 63, 0.25);

  &:hover {
    background: $ink-hover;
  }
}

.chat__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: $radius-pill;
  background: $primary;
  color: $text-dark;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
}

.chat__panel {
  display: flex;
  flex-direction: column;
  width: min(360px, calc(100vw - 32px));
  height: min(480px, calc(100vh - 140px));
  overflow: hidden;
  background: $cream;
  border: 1px solid $border;
  border-radius: $radius-lg;
  box-shadow: 0 16px 40px rgba(74, 63, 63, 0.22);
  @include fade-in;
}

.chat__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid $border;

  h2 {
    font-size: 22px;
  }
}

.chat__close {
  display: flex;
  padding: 8px;
  border: 1px solid $border;
  border-radius: $radius-pill;
  background: none;
  color: $text-dark;
  cursor: pointer;

  &:hover {
    background: $secondary;
  }
}

.chat__list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  overflow-y: auto;
}

.chat__note {
  font-size: 13.5px;
  line-height: 1.6;
  color: $text-muted;

  &--error {
    color: $rose;
  }
}

.chat__msg {
  align-self: flex-start;
  max-width: 82%;
  padding: 9px 13px;
  background: $white;
  border: 1px solid $border;
  border-radius: 14px 14px 14px 4px;

  p {
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  time {
    display: block;
    margin-top: 3px;
    font-size: 10.5px;
    color: $text-muted;
  }

  &--mine {
    align-self: flex-end;
    background: $primary;
    border-color: $primary-border;
    border-radius: 14px 14px 4px 14px;
  }
}

.chat__offline {
  padding: 6px 18px;
  font-size: 12px;
  letter-spacing: 0.08em;
  background: $secondary;
  color: $rose-dark;
}

.chat__form {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid $border;
  background: $white;
}

.chat__input {
  flex: 1;
  min-height: 40px;
  max-height: 96px;
  padding: 10px 12px;
  border: 1px solid $border;
  border-radius: $radius-md;
  background: $cream;
  color: $text-dark;
  font-size: 14px;
  resize: none;
}

.chat__send {
  display: flex;
  padding: 11px;
  border: 0;
  border-radius: $radius-pill;
  background: $text-dark;
  color: $cream;
  cursor: pointer;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}
```

Modify `ko_front/src/app/app.ts`: add `import { ChatWidgetComponent } from './shared/components/chat-widget/chat-widget';`, add `ChatWidgetComponent` to `imports`, and add `<app-chat-widget />` after `<app-footer />` in the template.

- [ ] **Step 4: Run to verify it passes**

Run the frontend test command and the build. Expected: "Frontend green" (10 new tests pass; check the build prints no new budget error for `chat-widget.scss`).

- [ ] **Step 5: Manual smoke** — needs the API running (restarted, migration applied) and `ng serve`: log in as `cliente@email.com` / `cliente123`, click "¿Necesitas ayuda?", send a message and see it appear; log in as admin in another browser and confirm the button is not shown.

- [ ] **Step 6: Commit**

```bash
git add ko_front/src/app/shared/components/chat-widget ko_front/src/app/app.ts
git commit -m "feat(frontend): add floating help chat widget for customers" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

### Task 8b: Verify and merge `feat/chat-widget`

- [ ] **Step 1:** frontend green; backend `uv run pytest -q` green.
- [ ] **Step 2: Merge**

```bash
git checkout dev
git merge --no-ff feat/chat-widget -m "Merge feat/chat-widget into dev" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Ask the user before pushing.

---

## Branch 4 — `feat/chat-admin`

```bash
git checkout dev && git checkout -b feat/chat-admin
```

### Task 9: Admin side of `ChatService`

**Files:**
- Modify (full replacement): `ko_front/src/app/core/services/chat.service.ts`
- Modify (append a `describe`): `ko_front/src/app/core/services/chat.service.spec.ts`

**Interfaces:**
- Consumes: everything from Task 7, plus `ChatThreadApi`/`ChatThread` from `chat.model.ts`.
- Produces (in addition to the customer API): `threads: Signal<ChatThread[]>` (most recent activity first), `activeCustomerId: Signal<number | null>`, `activeMessages: Signal<ChatMessage[]>`, `adminUnreadTotal: Signal<number>`, `loadThreads(): Promise<void>`, `openThread(customerId): Promise<void>`, `closeThread(): void`, `sendTo(customerId, body): boolean`, `markReadFor(customerId): void`; exported `threadFromApi`.

- [ ] **Step 1: Write the failing tests** — append to `chat.service.spec.ts` (reuses `setup`, `api`, `FakeRealtime` and `messagesUrl` from the customer describe; add the imports `ChatThreadApi` to the existing `chat.model` import):

```ts
const threadsUrl = `${environment.apiUrl}/chat/threads`;
const threadUrl = (id: number) => `${environment.apiUrl}/chat/threads/${id}/messages`;

const apiThread = (customerId: number, unread: number, over: Partial<ChatMessageApi> = {}): ChatThreadApi => ({
  customer_id: customerId,
  customer_email: `c${customerId}@x.com`,
  unread_count: unread,
  last_message: api({ id: customerId * 10, customer_id: customerId, sender_id: customerId, ...over }),
});

async function adminLoaded(threads: ChatThreadApi[]) {
  const ctx = setup('admin');
  ctx.http.expectOne(threadsUrl).flush(threads);
  await vi.waitFor(() => expect(ctx.service.threads()).toHaveLength(threads.length));
  return ctx;
}

describe('ChatService (admin)', () => {
  it('loads the thread list on login and sums unread', async () => {
    const { service } = await adminLoaded([apiThread(7, 2), apiThread(8, 1)]);
    expect(service.threads().map(t => t.customerEmail)).toEqual(['c7@x.com', 'c8@x.com']);
    expect(service.adminUnreadTotal()).toBe(3);
  });

  it('does not load the customer thread for an admin', () => {
    const { http } = setup('admin');
    http.expectNone(r => r.url === messagesUrl);
    http.expectOne(threadsUrl);
  });

  it('opens a thread, loads its history and marks it read', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 2)]);
    const opening = service.openThread(7);
    http.expectOne(r => r.url === threadUrl(7)).flush([api({ id: 1, customer_id: 7, sender_id: 7 })]);
    await opening;

    expect(service.activeCustomerId()).toBe(7);
    expect(service.activeMessages()).toHaveLength(1);
    expect(realtime.send).toHaveBeenCalledWith({ type: 'chat.read', customer_id: 7 });
  });

  it('does not send a read receipt for a thread with nothing unread', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 0)]);
    const opening = service.openThread(7);
    http.expectOne(r => r.url === threadUrl(7)).flush([]);
    await opening;
    expect(realtime.send).not.toHaveBeenCalled();
  });

  it('a message in a closed thread moves it to the top and increments unread', async () => {
    const { service, realtime } = await adminLoaded([apiThread(7, 0), apiThread(8, 0)]);
    realtime.events.next({
      type: 'chat.message',
      message: api({ id: 500, customer_id: 8, sender_id: 8, body: 'nuevo' }),
    });

    expect(service.threads().map(t => t.customerId)).toEqual([8, 7]);
    expect(service.threads()[0].unreadCount).toBe(1);
    expect(service.threads()[0].lastMessage.body).toBe('nuevo');
    expect(service.adminUnreadTotal()).toBe(1);
  });

  it('ignores a message it already has (no double counting)', async () => {
    const { service, realtime } = await adminLoaded([apiThread(7, 0)]);
    const event: ServerEvent = { type: 'chat.message', message: api({ id: 500, customer_id: 7, sender_id: 7 }) };
    realtime.events.next(event);
    realtime.events.next(event);
    expect(service.threads()[0].unreadCount).toBe(1);
  });

  it('a message in the open thread is appended and read straight away', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 0)]);
    const opening = service.openThread(7);
    http.expectOne(r => r.url === threadUrl(7)).flush([]);
    await opening;

    realtime.events.next({ type: 'chat.message', message: api({ id: 501, customer_id: 7, sender_id: 7 }) });

    expect(service.activeMessages()).toHaveLength(1);
    expect(service.threads()[0].unreadCount).toBe(0);
    expect(realtime.send).toHaveBeenCalledWith({ type: 'chat.read', customer_id: 7 });
  });

  it('a message from an unknown customer reloads the thread list', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 0)]);
    realtime.events.next({ type: 'chat.message', message: api({ id: 600, customer_id: 9, sender_id: 9 }) });
    http.expectOne(threadsUrl).flush([apiThread(9, 1), apiThread(7, 0)]);
    await vi.waitFor(() => expect(service.threads()).toHaveLength(2));
  });

  it('an admin read clears the unread count and marks the open thread', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 2)]);
    const opening = service.openThread(7);
    http.expectOne(r => r.url === threadUrl(7)).flush([api({ id: 1, customer_id: 7, sender_id: 7 })]);
    await opening;

    realtime.events.next({ type: 'chat.read', customer_id: 7, reader_role: 'admin' });

    expect(service.threads()[0].unreadCount).toBe(0);
    expect(service.activeMessages()[0].readAt).not.toBeNull();
  });

  it('sendTo() forwards the customer id', async () => {
    const { service, realtime } = await adminLoaded([apiThread(7, 0)]);
    expect(service.sendTo(7, 'hola')).toBe(true);
    expect(realtime.send).toHaveBeenCalledWith({ type: 'chat.send', body: 'hola', customer_id: 7 });
  });

  it('closeThread() forgets the open conversation', async () => {
    const { service, http } = await adminLoaded([apiThread(7, 0)]);
    const opening = service.openThread(7);
    http.expectOne(r => r.url === threadUrl(7)).flush([]);
    await opening;

    service.closeThread();
    expect(service.activeCustomerId()).toBeNull();
    expect(service.activeMessages()).toEqual([]);
  });

  it('reloads the list and the open thread after a reconnection', async () => {
    const { service, http, realtime } = await adminLoaded([apiThread(7, 0)]);
    const opening = service.openThread(7);
    http.expectOne(r => r.url === threadUrl(7)).flush([]);
    await opening;

    realtime.reconnected.next();
    http.expectOne(threadsUrl).flush([apiThread(7, 3)]);
    await vi.waitFor(() => expect(service.threads()[0].unreadCount).toBe(3));
    http.expectOne(r => r.url === threadUrl(7)).flush([api({ id: 1, customer_id: 7, sender_id: 7 })]);
    await vi.waitFor(() => expect(service.activeMessages()).toHaveLength(1));
  });

  it('clears everything on logout', async () => {
    const { service, user } = await adminLoaded([apiThread(7, 1)]);
    user.set(undefined);
    TestBed.tick();
    expect(service.threads()).toEqual([]);
    expect(service.adminUnreadTotal()).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run the frontend test command. Expected: FAIL — `service.threads is not a function` and similar (the 11 customer tests still pass).

- [ ] **Step 3: Implement** — replace `ko_front/src/app/core/services/chat.service.ts` with the final version:

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { ChatMessage, ChatMessageApi, ChatRole, ChatThread, ChatThreadApi } from '../models/chat.model';
import type { ServerEvent } from '../models/realtime.model';
import type { AppUser } from '../models/user.model';
import { AuthService } from './auth.service';
import { RealtimeService } from './realtime.service';

const API = `${environment.apiUrl}/chat`;
const PAGE_SIZE = 50;

export function messageFromApi(m: ChatMessageApi): ChatMessage {
  return {
    id: m.id,
    customerId: m.customer_id,
    senderId: m.sender_id,
    senderRole: m.sender_role,
    body: m.body,
    createdAt: Date.parse(m.created_at),
    readAt: m.read_at ? Date.parse(m.read_at) : null,
  };
}

export function threadFromApi(t: ChatThreadApi): ChatThread {
  return {
    customerId: t.customer_id,
    customerEmail: t.customer_email,
    lastMessage: messageFromApi(t.last_message),
    unreadCount: t.unread_count,
  };
}

function upsert(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return list.some(m => m.id === message.id) ? list.map(m => (m.id === message.id ? message : m)) : [...list, message];
}

/** Marca como leídos los mensajes que lee `readerRole` (los del otro lado). */
function withRead(list: ChatMessage[], readerRole: ChatRole): ChatMessage[] {
  const target: ChatRole = readerRole === 'admin' ? 'customer' : 'admin';
  const now = Date.now();
  return list.map(m => (m.senderRole === target && m.readAt === null ? { ...m, readAt: now } : m));
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private realtime = inject(RealtimeService);

  readonly canSend = computed(() => this.realtime.status() === 'open');
  readonly loadError = signal('');

  // Cliente: su único hilo
  readonly customerMessages = signal<ChatMessage[]>([]);
  readonly customerUnread = computed(
    () => this.customerMessages().filter(m => m.senderRole === 'admin' && m.readAt === null).length
  );

  // Admin: lista de hilos y conversación abierta
  readonly threads = signal<ChatThread[]>([]);
  readonly activeCustomerId = signal<number | null>(null);
  readonly activeMessages = signal<ChatMessage[]>([]);
  readonly adminUnreadTotal = computed(() => this.threads().reduce((sum, t) => sum + t.unreadCount, 0));

  constructor() {
    effect(() => {
      const role = this.auth.currentUser()?.role;
      untracked(() => {
        this.reset();
        void this.load(role);
      });
    });
    this.realtime.events$.subscribe(event => this.onEvent(event));
    this.realtime.reconnected$.subscribe(() => void this.load(this.auth.currentUser()?.role));
  }

  // ---- cliente ----

  async loadCustomerThread(): Promise<void> {
    const rows = await firstValueFrom(this.http.get<ChatMessageApi[]>(`${API}/messages`, { params: { limit: PAGE_SIZE } }));
    this.customerMessages.set(rows.map(messageFromApi));
  }

  /** Devuelve false si no se pudo enviar (conexión caída): el mensaje no se encola. */
  send(body: string): boolean {
    return this.realtime.send({ type: 'chat.send', body });
  }

  markRead(): void {
    if (this.customerUnread() > 0) this.realtime.send({ type: 'chat.read' });
  }

  // ---- admin ----

  async loadThreads(): Promise<void> {
    const rows = await firstValueFrom(this.http.get<ChatThreadApi[]>(`${API}/threads`));
    this.threads.set(rows.map(threadFromApi));
  }

  async openThread(customerId: number): Promise<void> {
    this.activeCustomerId.set(customerId);
    this.activeMessages.set([]);
    await this.loadActive(customerId);
    if ((this.threads().find(t => t.customerId === customerId)?.unreadCount ?? 0) > 0) this.markReadFor(customerId);
  }

  closeThread(): void {
    this.activeCustomerId.set(null);
    this.activeMessages.set([]);
  }

  sendTo(customerId: number, body: string): boolean {
    return this.realtime.send({ type: 'chat.send', body, customer_id: customerId });
  }

  markReadFor(customerId: number): void {
    this.realtime.send({ type: 'chat.read', customer_id: customerId });
  }

  // ---- interno ----

  private reset(): void {
    this.customerMessages.set([]);
    this.threads.set([]);
    this.activeCustomerId.set(null);
    this.activeMessages.set([]);
    this.loadError.set('');
  }

  private async loadActive(customerId: number): Promise<void> {
    const rows = await firstValueFrom(
      this.http.get<ChatMessageApi[]>(`${API}/threads/${customerId}/messages`, { params: { limit: PAGE_SIZE } })
    );
    if (this.activeCustomerId() === customerId) this.activeMessages.set(rows.map(messageFromApi));
  }

  private async load(role: AppUser['role'] | undefined): Promise<void> {
    try {
      if (role === 'customer') {
        await this.loadCustomerThread();
      } else if (role === 'admin') {
        await this.loadThreads();
        const active = this.activeCustomerId();
        if (active !== null) await this.loadActive(active);
      }
      this.loadError.set('');
    } catch {
      this.loadError.set('No se pudo cargar el chat. Se reintentará al reconectar.');
    }
  }

  private onEvent(event: ServerEvent): void {
    const user = this.auth.currentUser();
    if (!user) return;
    if (event.type === 'chat.message') this.onMessage(user, messageFromApi(event.message));
    else if (event.type === 'chat.read') this.onRead(user, event.customer_id, event.reader_role);
  }

  private onMessage(user: AppUser, message: ChatMessage): void {
    if (user.role === 'customer') {
      if (message.customerId === user.id) this.customerMessages.update(list => upsert(list, message));
      return;
    }

    const isActive = this.activeCustomerId() === message.customerId;
    if (isActive) this.activeMessages.update(list => upsert(list, message));

    if (!this.threads().some(t => t.customerId === message.customerId)) {
      void this.loadThreads();
      return;
    }
    this.threads.update(list => {
      const thread = list.find(t => t.customerId === message.customerId)!;
      if (thread.lastMessage.id >= message.id) return list;
      const unread = thread.unreadCount + (message.senderRole === 'customer' && !isActive ? 1 : 0);
      return [{ ...thread, lastMessage: message, unreadCount: unread }, ...list.filter(t => t !== thread)];
    });
    if (isActive && message.senderRole === 'customer') this.markReadFor(message.customerId);
  }

  private onRead(user: AppUser, customerId: number, readerRole: ChatRole): void {
    if (user.role === 'customer') {
      if (customerId === user.id) this.customerMessages.update(list => withRead(list, readerRole));
      return;
    }
    if (readerRole === 'admin') {
      this.threads.update(list => list.map(t => (t.customerId === customerId ? { ...t, unreadCount: 0 } : t)));
    }
    if (this.activeCustomerId() === customerId) this.activeMessages.update(list => withRead(list, readerRole));
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run the frontend test command and the build. Expected: "Frontend green" (13 new admin tests plus the 11 customer ones pass).

- [ ] **Step 5: Commit**

```bash
git add ko_front/src/app/core/services/chat.service.ts ko_front/src/app/core/services/chat.service.spec.ts
git commit -m "feat(frontend): add admin thread list and conversation state to ChatService" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

### Task 10: Admin "Chat" tab

**Files:**
- Create: `ko_front/src/app/pages/admin/admin-chat/admin-chat.ts`, `.html`, `.scss`, `admin-chat.spec.ts`
- Modify: `ko_front/src/app/pages/admin/admin.ts`, `admin.html`, `admin.scss`, `admin.spec.ts`

**Interfaces:**
- Consumes: `ChatService` (`threads`, `activeCustomerId`, `activeMessages`, `adminUnreadTotal`, `canSend`, `loadError`, `openThread`, `closeThread`, `sendTo`).
- Produces: `<app-admin-chat />` (`AdminChatComponent`); the `Chat` tab in `AdminComponent` (`activeTab` becomes `'productos' | 'pedidos' | 'chat'`) with an unread badge.

- [ ] **Step 1: Write the failing tests** — `ko_front/src/app/pages/admin/admin-chat/admin-chat.spec.ts`

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ChatService } from '../../../core/services/chat.service';
import { AdminChatComponent } from './admin-chat';
import type { ChatMessage, ChatThread } from '../../../core/models/chat.model';

class FakeChat {
  threads = signal<ChatThread[]>([]);
  activeCustomerId = signal<number | null>(null);
  activeMessages = signal<ChatMessage[]>([]);
  canSend = signal(true);
  loadError = signal('');
  openThread = vi.fn().mockResolvedValue(undefined);
  closeThread = vi.fn();
  sendTo = vi.fn().mockReturnValue(true);
}

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 1,
  customerId: 7,
  senderId: 7,
  senderRole: 'customer',
  body: 'hola',
  createdAt: Date.parse('2026-09-21T10:00:00'),
  readAt: null,
  ...over,
});

const thread = (customerId: number, unread: number, body = 'hola'): ChatThread => ({
  customerId,
  customerEmail: `c${customerId}@x.com`,
  unreadCount: unread,
  lastMessage: msg({ id: customerId, customerId, body }),
});

describe('AdminChatComponent', () => {
  let fixture: ComponentFixture<AdminChatComponent>;
  let chat: FakeChat;
  const all = (selector: string) => Array.from(fixture.nativeElement.querySelectorAll(selector)) as HTMLElement[];
  const one = (selector: string) => fixture.nativeElement.querySelector(selector) as HTMLElement | null;

  beforeEach(async () => {
    chat = new FakeChat();
    await TestBed.configureTestingModule({
      imports: [AdminChatComponent],
      providers: [{ provide: ChatService, useValue: chat }],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminChatComponent);
    fixture.detectChanges();
  });

  it('explains there are no conversations yet', () => {
    expect(one('.achat__list')?.textContent).toContain('Todavía no hay conversaciones');
  });

  it('lists the customers with their last message and unread badge', () => {
    chat.threads.set([thread(7, 2, 'necesito ayuda'), thread(8, 0)]);
    fixture.detectChanges();

    const rows = all('.achat__thread');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('c7@x.com');
    expect(rows[0].textContent).toContain('necesito ayuda');
    expect(rows[0].querySelector('.achat__badge')?.textContent?.trim()).toBe('2');
    expect(rows[1].querySelector('.achat__badge')).toBeNull();
  });

  it('opens a conversation when a thread is chosen', () => {
    chat.threads.set([thread(7, 1)]);
    fixture.detectChanges();
    all('.achat__thread')[0].click();
    expect(chat.openThread).toHaveBeenCalledWith(7);
  });

  it('asks to pick a conversation until one is open', () => {
    expect(one('.achat__conversation')?.textContent).toContain('Elige una conversación');
    chat.activeCustomerId.set(7);
    fixture.detectChanges();
    expect(one('.achat__form')).not.toBeNull();
  });

  it('renders the open conversation as text', () => {
    chat.threads.set([thread(7, 0)]);
    chat.activeCustomerId.set(7);
    chat.activeMessages.set([msg({ id: 1, body: '<i>hola</i>' }), msg({ id: 2, senderRole: 'admin', senderId: 1, body: 'buenas' })]);
    fixture.detectChanges();

    const items = all('.achat__msg');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('<i>hola</i>');
    expect(items[0].querySelector('i')).toBeNull();
    expect(items[1].classList).toContain('achat__msg--mine');
  });

  it('replies to the open customer and clears the draft', () => {
    chat.activeCustomerId.set(7);
    fixture.detectChanges();
    const textarea = one('.achat__input') as HTMLTextAreaElement;
    textarea.value = '  Claro que sí  ';
    textarea.dispatchEvent(new Event('input'));
    (one('.achat__form') as HTMLFormElement).dispatchEvent(new Event('submit'));

    expect(chat.sendTo).toHaveBeenCalledWith(7, 'Claro que sí');
    fixture.detectChanges();
    expect((one('.achat__input') as HTMLTextAreaElement).value).toBe('');
  });

  it('does not send empty replies or while the connection is down', () => {
    chat.activeCustomerId.set(7);
    fixture.detectChanges();
    (one('.achat__form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    expect(chat.sendTo).not.toHaveBeenCalled();

    chat.canSend.set(false);
    const textarea = one('.achat__input') as HTMLTextAreaElement;
    textarea.value = 'hola';
    textarea.dispatchEvent(new Event('input'));
    (one('.achat__form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(chat.sendTo).not.toHaveBeenCalled();
    expect(one('.achat__offline')?.textContent).toContain('Reconectando');
  });

  it('closes the open conversation when the tab is left', () => {
    fixture.destroy();
    expect(chat.closeThread).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run the frontend test command. Expected: FAIL — `admin-chat` not found.

- [ ] **Step 3: Implement** — `ko_front/src/app/pages/admin/admin-chat/admin-chat.ts`

```ts
import { DatePipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { ChatService } from '../../../core/services/chat.service';

@Component({
  selector: 'app-admin-chat',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './admin-chat.html',
  styleUrl: './admin-chat.scss',
})
export class AdminChatComponent {
  chat = inject(ChatService);
  draft = signal('');
  private list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    // Al salir de la pestaña se cierra la conversación: lo que llegue después cuenta como no leído.
    inject(DestroyRef).onDestroy(() => this.chat.closeThread());
    effect(() => {
      this.chat.activeMessages();
      const el = this.list()?.nativeElement;
      if (el) setTimeout(() => (el.scrollTop = el.scrollHeight));
    });
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    this.submit();
  }

  onEnter(event: Event): void {
    if ((event as KeyboardEvent).shiftKey) return;
    event.preventDefault();
    this.submit();
  }

  private submit(): void {
    const customerId = this.chat.activeCustomerId();
    const body = this.draft().trim();
    if (customerId === null || !body || !this.chat.canSend()) return;
    if (this.chat.sendTo(customerId, body)) this.draft.set('');
  }
}
```

`admin-chat.html`

```html
<div class="achat">
  <aside class="achat__list" aria-label="Conversaciones">
    @if (chat.loadError()) {
    <p class="achat__empty achat__empty--error">{{ chat.loadError() }}</p>
    }
    @if (chat.threads().length === 0) {
    <p class="achat__empty">Todavía no hay conversaciones.</p>
    }
    @for (t of chat.threads(); track t.customerId) {
    <button type="button" class="achat__thread" [class.achat__thread--active]="chat.activeCustomerId() === t.customerId"
      (click)="chat.openThread(t.customerId)">
      <span class="achat__who">{{ t.customerEmail }}</span>
      <span class="achat__last">{{ t.lastMessage.body }}</span>
      @if (t.unreadCount > 0) {
      <span class="achat__badge">{{ t.unreadCount }}</span>
      }
    </button>
    }
  </aside>

  <section class="achat__conversation" aria-label="Conversación">
    @if (chat.activeCustomerId() === null) {
    <p class="achat__empty">Elige una conversación de la lista para verla y responder.</p>
    } @else {
    <div #list class="achat__messages" role="log" aria-live="polite">
      @for (m of chat.activeMessages(); track m.id) {
      <div class="achat__msg" [class.achat__msg--mine]="m.senderRole === 'admin'">
        <p>{{ m.body }}</p>
        <time>{{ m.createdAt | date:'d MMM · HH:mm' }}</time>
      </div>
      }
    </div>

    @if (!chat.canSend()) {
    <p class="achat__offline" role="status">Reconectando…</p>
    }

    <form class="achat__form" (submit)="onSubmit($event)">
      <textarea class="achat__input" rows="2" maxlength="1000" placeholder="Escribe tu respuesta"
        aria-label="Respuesta" [value]="draft()" (input)="draft.set($any($event.target).value)"
        (keydown.enter)="onEnter($event)"></textarea>
      <button type="submit" class="btn-dark" [disabled]="!chat.canSend()">Enviar</button>
    </form>
    }
  </section>
</div>
```

`admin-chat.scss`

```scss
@use '../../../../styles/variables' as *;
@use '../../../../styles/mixins' as *;

.achat {
  display: grid;
  grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
  min-height: 460px;
  @include card;
  overflow: hidden;
}

.achat__list {
  display: flex;
  flex-direction: column;
  border-right: 1px solid $border;
  overflow-y: auto;
  max-height: 560px;
}

.achat__thread {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 14px 44px 14px 18px;
  border: 0;
  border-bottom: 1px solid $border-soft;
  background: none;
  text-align: left;
  cursor: pointer;

  &:hover,
  &--active {
    background: $secondary;
  }
}

.achat__who {
  font-size: 14px;
  color: $text-dark;
}

.achat__last {
  font-size: 12.5px;
  color: $text-muted;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.achat__badge {
  position: absolute;
  top: 50%;
  right: 16px;
  transform: translateY(-50%);
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: $radius-pill;
  background: $rose;
  color: $white;
  font-size: 11px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.achat__conversation {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.achat__empty {
  padding: 24px 20px;
  font-size: 14px;
  line-height: 1.6;
  color: $text-muted;

  &--error {
    color: $rose;
  }
}

.achat__messages {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 20px;
  overflow-y: auto;
  max-height: 440px;
}

.achat__msg {
  align-self: flex-start;
  max-width: 78%;
  padding: 9px 13px;
  background: $white;
  border: 1px solid $border;
  border-radius: 14px 14px 14px 4px;

  p {
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  time {
    display: block;
    margin-top: 3px;
    font-size: 10.5px;
    color: $text-muted;
  }

  &--mine {
    align-self: flex-end;
    background: $primary;
    border-color: $primary-border;
    border-radius: 14px 14px 4px 14px;
  }
}

.achat__offline {
  padding: 6px 20px;
  font-size: 12px;
  letter-spacing: 0.08em;
  background: $secondary;
  color: $rose-dark;
}

.achat__form {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 14px 18px;
  border-top: 1px solid $border;
}

.achat__input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid $border;
  border-radius: $radius-md;
  background: $cream;
  color: $text-dark;
  font-size: 14px;
  resize: none;
}

@media (max-width: 720px) {
  .achat {
    grid-template-columns: 1fr;
  }

  .achat__list {
    border-right: 0;
    border-bottom: 1px solid $border;
    max-height: 220px;
  }
}
```

- [ ] **Step 4: Add the tab to the admin panel**

`ko_front/src/app/pages/admin/admin.ts` — import and inject:

```ts
import { ChatService } from '../../core/services/chat.service';
import { AdminChatComponent } from './admin-chat/admin-chat';
```

Add `AdminChatComponent` to the component `imports` array, and in the class:

```ts
  chat = inject(ChatService);
```

and widen the tab type:

```ts
  activeTab = signal<'productos' | 'pedidos' | 'chat'>('productos');
```

`admin.html` — inside the `.admin__tabs` div, after the "Pedidos" button, add:

```html
      <button type="button" role="tab" class="admin__tab" [class.admin__tab--active]="activeTab() === 'chat'"
        [attr.aria-selected]="activeTab() === 'chat'" (click)="activeTab.set('chat')">
        Chat
        @if (chat.adminUnreadTotal() > 0) {
        <span class="admin__tab-badge">{{ chat.adminUnreadTotal() }}</span>
        }
      </button>
```

and, just before the closing `</section>` of the page, add:

```html
  @if (activeTab() === 'chat') {
  <app-admin-chat />
  }
```

`admin.scss` — append:

```scss
.admin__tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  margin-left: 8px;
  padding: 0 5px;
  border-radius: $radius-pill;
  background: $rose;
  color: $white;
  font-size: 10.5px;
  letter-spacing: 0;
}
```

`admin.spec.ts` — the component now injects `ChatService`, so every `TestBed.configureTestingModule` in that file (the top-level `beforeEach` and the `create()` helper inside `live orders`) needs a fake. Add near the other fakes:

```ts
import { signal } from '@angular/core';
import { ChatService } from '../../core/services/chat.service';

class FakeChatService {
  adminUnreadTotal = signal(0);
  // Lo que usa el componente hijo `app-admin-chat` cuando se abre la pestaña:
  threads = signal([]);
  activeCustomerId = signal<number | null>(null);
  activeMessages = signal([]);
  canSend = signal(true);
  loadError = signal('');
  openThread = vi.fn();
  closeThread = vi.fn();
  sendTo = vi.fn();
}
```

and add `{ provide: ChatService, useClass: FakeChatService },` to the `providers` array of each configuration. Then add these tests inside the top-level `describe`:

```ts
  it('shows the Chat tab with the unread total', () => {
    const chat = TestBed.inject(ChatService) as unknown as FakeChatService;
    chat.adminUnreadTotal.set(3);
    fixture.detectChanges();
    const tabs = Array.from(fixture.nativeElement.querySelectorAll('.admin__tab')) as HTMLElement[];
    const chatTab = tabs.find(t => t.textContent?.includes('Chat'))!;
    expect(chatTab.querySelector('.admin__tab-badge')?.textContent?.trim()).toBe('3');
  });

  it('switches to the chat panel', () => {
    component.activeTab.set('chat');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-admin-chat')).not.toBeNull();
  });
```


- [ ] **Step 5: Run to verify it passes**

Run the frontend test command and the build. Expected: "Frontend green" (8 new `AdminChat` tests and 2 new admin tests pass; no new budget error — `admin.scss` was already a warning).

- [ ] **Step 6: Manual smoke** — customer sends a message from the widget; in the admin session the "Chat" tab badge shows 1, the thread appears, opening it shows the message and clears the badge, and a reply appears in the customer widget instantly.

- [ ] **Step 7: Commit**

```bash
git add ko_front/src/app/pages/admin
git commit -m "feat(frontend): add Chat tab to the admin panel with conversations and live replies" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

### Task 10b: Verify and merge `feat/chat-admin`

- [ ] **Step 1:** frontend green; backend `uv run pytest -q` green.
- [ ] **Step 2: Merge**

```bash
git checkout dev
git merge --no-ff feat/chat-admin -m "Merge feat/chat-admin into dev" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Ask the user before pushing.

---

## Branch 5 — `feat/ws-orders`

```bash
git checkout dev && git checkout -b feat/ws-orders
```

### Task 11: Publish order events from the REST endpoints

**Files:**
- Create: `ko_back/tests/test_orders_realtime.py`
- Modify: `ko_back/app/api/orders.py`

**Interfaces:**
- Consumes: `manager`, `publish_sync` (Task 1).
- Produces: event `order.created {order}` to all admins after `POST /orders`; event `order.updated {order}` to the order's owner and all admins after `PATCH /orders/{id}/status`. `order` has the `OrderResponse` shape (snake_case, JSON-serialised).

- [ ] **Step 1: Write the failing tests** — `ko_back/tests/test_orders_realtime.py`

```python
from contextlib import contextmanager

from app.core.realtime import manager
from app.models.product import Product, ProductCategory


@contextmanager
def connect(client, token: str):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": token})
        assert ws.receive_json()["type"] == "ready"
        yield ws


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _product(db_session) -> int:
    product = Product(name="Mochi", price=3.5, description="d", emoji="", category=ProductCategory.MOCHI)
    db_session.add(product)
    db_session.commit()
    return product.id


def _place_order(client, token: str, product_id: int):
    return client.post(
        "/orders",
        json={
            "items": [{"product_id": product_id, "quantity": 2}],
            "pickup_name": "Ana",
            "pickup_phone": "600111222",
            "pickup_time": "2026-09-22T18:00",
        },
        headers=_auth(token),
    )


def test_new_orders_are_pushed_to_admins_only(client, db_session, admin_token, customer_token) -> None:
    product_id = _product(db_session)
    other_token = client.post("/auth/register", json={"email": "otra@test.com", "password": "secret123"}).json()[
        "access_token"
    ]

    with connect(client, admin_token) as admin, connect(client, other_token) as other:
        response = _place_order(client, customer_token, product_id)
        assert response.status_code == 201
        event = admin.receive_json()

        assert event["type"] == "order.created"
        assert event["order"]["id"] == response.json()["id"]
        assert event["order"]["status"] == "pendiente"
        assert event["order"]["items"][0]["quantity"] == 2

        # Si el pedido se hubiese filtrado a otro cliente, llegaría antes que este evento.
        second = _place_order(client, other_token, product_id).json()["id"]
        admin.receive_json()
        client.patch(f"/orders/{second}/status", json={"status": "listo"}, headers=_auth(admin_token))
        assert other.receive_json()["type"] == "order.updated"


def test_status_changes_reach_the_owner_and_admins(client, db_session, admin_token, customer_token) -> None:
    product_id = _product(db_session)
    order_id = _place_order(client, customer_token, product_id).json()["id"]

    with connect(client, admin_token) as admin, connect(client, customer_token) as customer:
        response = client.patch(f"/orders/{order_id}/status", json={"status": "listo"}, headers=_auth(admin_token))
        assert response.status_code == 200

        for ws in (customer, admin):
            event = ws.receive_json()
            assert event["type"] == "order.updated"
            assert event["order"]["id"] == order_id
            assert event["order"]["status"] == "listo"


def test_a_failed_publish_does_not_fail_the_request(client, db_session, customer_token, monkeypatch) -> None:
    product_id = _product(db_session)

    async def broken(event) -> None:
        raise RuntimeError("socket roto")

    monkeypatch.setattr(manager, "send_to_admins", broken)

    assert _place_order(client, customer_token, product_id).status_code == 201
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_orders_realtime.py -q` — Expected: FAIL — the admin socket never receives an event (the `receive_json()` blocks; if the run hangs, stop it with Ctrl+C — that is the failure).

- [ ] **Step 3: Implement** — modify `ko_back/app/api/orders.py`:

Add the import next to the other `app.core` imports:

```python
from app.core.realtime import manager, publish_sync
```

In `create_order`, replace the last two lines (`db.refresh(order)` / `return _to_response(order)`) with:

```python
    db.refresh(order)
    response = _to_response(order)
    publish_sync(manager.send_to_admins, {"type": "order.created", "order": response.model_dump(mode="json")})
    return response
```

In `update_order_status`, replace the last two lines with:

```python
    db.refresh(order)
    response = _to_response(order)
    event = {"type": "order.updated", "order": response.model_dump(mode="json")}
    publish_sync(manager.send_to_user, order.user_id, event)
    publish_sync(manager.send_to_admins, event)
    return response
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest -q` — Expected: all pass, including the existing order tests (no sockets connected means publishing is a no-op).

- [ ] **Step 5: Commit**

```bash
git add ko_back/app/api/orders.py ko_back/tests/test_orders_realtime.py
git commit -m "feat(backend): push order.created and order.updated events over the websocket" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

### Task 12: Live orders for the customer

**Files:**
- Create: `ko_front/src/app/core/utils/orders.ts`, `ko_front/src/app/core/utils/orders.spec.ts`
- Modify: `ko_front/src/app/core/services/order.service.ts`, `ko_front/src/app/core/models/realtime.model.ts`, `ko_front/src/app/pages/orders/orders.ts`, `ko_front/src/app/pages/orders/orders.spec.ts`

**Interfaces:**
- Consumes: `RealtimeService.events$`, `.reconnected$`; `OrderService.getMine()`.
- Produces: `upsertOrder(list: Order[], order: Order): Order[]` (replace by id or prepend; sorted newest first); exported `OrderApiResponse` and `orderFromApi(row): Order` from `order.service.ts`; `OrderEvent` in `realtime.model.ts`.

- [ ] **Step 1: Write the failing tests**

`ko_front/src/app/core/utils/orders.spec.ts`

```ts
import { upsertOrder } from './orders';
import type { Order } from '../models/order.model';

const order = (id: number, createdAt: number, status: Order['status'] = 'pendiente'): Order => ({
  id,
  userId: 1,
  items: [],
  total: 0,
  pickupName: 'Ana',
  pickupPhone: '600',
  pickupTime: '2026-09-22T18:00',
  status,
  createdAt,
});

describe('upsertOrder', () => {
  it('replaces an existing order in place', () => {
    const list = [order(2, 200), order(1, 100)];
    const next = upsertOrder(list, order(1, 100, 'listo'));
    expect(next.map(o => o.id)).toEqual([2, 1]);
    expect(next[1].status).toBe('listo');
  });

  it('adds a new order and keeps the newest first', () => {
    const next = upsertOrder([order(1, 100)], order(2, 200));
    expect(next.map(o => o.id)).toEqual([2, 1]);
  });

  it('breaks ties by id and does not mutate the input', () => {
    const list = [order(1, 100)];
    const next = upsertOrder(list, order(2, 100));
    expect(next.map(o => o.id)).toEqual([2, 1]);
    expect(list).toHaveLength(1);
  });
});
```

Replace `ko_front/src/app/pages/orders/orders.spec.ts` with:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { OrdersComponent } from './orders';
import { OrderService } from '../../core/services/order.service';
import { RealtimeService } from '../../core/services/realtime.service';
import type { Order } from '../../core/models/order.model';
import type { ServerEvent } from '../../core/models/realtime.model';

const SAMPLE_ORDERS: Order[] = [
  {
    id: 1,
    userId: 2,
    items: [{ productId: 1, name: 'Mochi de Fresa', price: 3.5, quantity: 2 }],
    total: 7,
    pickupName: 'Ana',
    pickupPhone: '600111222',
    pickupTime: '2026-09-22T18:00',
    status: 'pendiente',
    createdAt: 1700000000000,
  },
];

const apiOrder = (over: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 2,
  items: [{ product_id: 1, name: 'Mochi de Fresa', price: 3.5, quantity: 2 }],
  total: 7,
  pickup_name: 'Ana',
  pickup_phone: '600111222',
  pickup_time: '2026-09-22T18:00',
  status: 'listo',
  created_at: '2023-11-14T22:13:20',
  ...over,
});

class FakeRealtime {
  events = new Subject<ServerEvent>();
  reconnected = new Subject<void>();
  events$ = this.events.asObservable();
  reconnected$ = this.reconnected.asObservable();
}

describe('OrdersComponent', () => {
  let component: OrdersComponent;
  let fixture: ComponentFixture<OrdersComponent>;
  let getMine: ReturnType<typeof vi.fn>;
  let realtime: FakeRealtime;

  beforeEach(async () => {
    getMine = vi.fn().mockReturnValue(of(SAMPLE_ORDERS));
    realtime = new FakeRealtime();

    await TestBed.configureTestingModule({
      imports: [OrdersComponent],
      providers: [
        { provide: OrderService, useValue: { getMine } },
        { provide: RealtimeService, useValue: realtime },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrdersComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads the orders of the current user once', () => {
    expect(getMine).toHaveBeenCalledTimes(1);
    expect(component.orders()).toEqual(SAMPLE_ORDERS);
  });

  it('shows a status change pushed by the admin without reloading', () => {
    realtime.events.next({ type: 'order.updated', order: apiOrder({ status: 'listo' }) } as ServerEvent);
    expect(component.orders()).toHaveLength(1);
    expect(component.orders()[0].status).toBe('listo');
    expect(getMine).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated events', () => {
    realtime.events.next({ type: 'error', code: 'x', detail: 'y' });
    expect(component.orders()).toEqual(SAMPLE_ORDERS);
  });

  it('reloads after a reconnection, in case events were missed', async () => {
    getMine.mockReturnValue(of([{ ...SAMPLE_ORDERS[0], status: 'entregado' }]));
    realtime.reconnected.next();
    await vi.waitFor(() => expect(component.orders()[0].status).toBe('entregado'));
    expect(getMine).toHaveBeenCalledTimes(2);
  });

  it('reports a load error and keeps the last orders', async () => {
    getMine.mockReturnValue(throwError(() => new Error('offline')));
    realtime.reconnected.next();
    await vi.waitFor(() => expect(component.loadError()).toBe('offline'));
    expect(component.orders()).toEqual(SAMPLE_ORDERS);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run the frontend test command. Expected: FAIL — `./orders` (utils) not found; the component spec fails on the missing `RealtimeService` behavior.

- [ ] **Step 3: Implement**

`ko_front/src/app/core/utils/orders.ts`

```ts
import type { Order } from '../models/order.model';

/** Reemplaza un pedido por id, o lo añade; siempre del más reciente al más antiguo. */
export function upsertOrder(list: Order[], order: Order): Order[] {
  const next = list.some(o => o.id === order.id) ? list.map(o => (o.id === order.id ? order : o)) : [order, ...list];
  return next.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
}
```

`ko_front/src/app/core/services/order.service.ts` — export the API type and the mapper:
- change `interface OrderApiResponse {` to `export interface OrderApiResponse {`;
- rename `function fromApi(row: OrderApiResponse): Order {` to `export function orderFromApi(row: OrderApiResponse): Order {`;
- replace the three call sites `rows.map(fromApi)` (in `getMine` and `getAll`) with `rows.map(orderFromApi)`, and `return fromApi(row);` (in `getById`) with `return orderFromApi(row);`.

`ko_front/src/app/core/models/realtime.model.ts` — add at the top `import type { OrderApiResponse } from '../services/order.service';`, then above the union:

```ts
export interface OrderEvent {
  type: 'order.created' | 'order.updated';
  order: OrderApiResponse;
}
```

and extend the union: `export type ServerEvent = ReadyEvent | ErrorEvent | ChatMessageEvent | ChatReadEvent | OrderEvent;`

`ko_front/src/app/pages/orders/orders.ts` — replace with:

```ts
import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { OrderService, orderFromApi } from '../../core/services/order.service';
import { RealtimeService } from '../../core/services/realtime.service';
import { upsertOrder } from '../../core/utils/orders';
import type { Order } from '../../core/models/order.model';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CurrencyPipe, DatePipe, RouterLink],
  templateUrl: './orders.html',
  styleUrl: './orders.scss',
})
export class OrdersComponent {
  private orderService = inject(OrderService);
  private realtime = inject(RealtimeService);

  loadError = signal('');
  orders = signal<Order[]>([]);

  constructor() {
    void this.load();
    // Recarga al reconectar por si se perdió algún evento.
    this.realtime.reconnected$.pipe(takeUntilDestroyed()).subscribe(() => void this.load());
    // Los cambios de estado que hace el admin llegan al instante.
    this.realtime.events$.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event.type === 'order.updated' || event.type === 'order.created') {
        this.orders.update(list => upsertOrder(list, orderFromApi(event.order)));
      }
    });
  }

  private async load(): Promise<void> {
    try {
      this.orders.set(await firstValueFrom(this.orderService.getMine()));
      this.loadError.set('');
    } catch (e) {
      // Se conservan los últimos pedidos mostrados.
      this.loadError.set((e as { message?: string }).message ?? 'Error al cargar tus pedidos');
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run the frontend test command and the build. Expected: "Frontend green" (3 `upsertOrder` and 6 `OrdersComponent` tests pass; the old polling tests are gone). Other specs that construct `OrdersComponent` do not exist, so nothing else needs a `RealtimeService` fake here.

- [ ] **Step 5: Manual smoke** — customer on "Mis pedidos", admin changes the order's state in another browser: the badge changes within a second without reloading.

- [ ] **Step 6: Commit**

```bash
git add ko_front/src/app/core/utils/orders.ts ko_front/src/app/core/utils/orders.spec.ts ko_front/src/app/core/services/order.service.ts ko_front/src/app/core/models/realtime.model.ts ko_front/src/app/pages/orders
git commit -m "feat(frontend): show order status changes to the customer instantly via websocket" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

### Task 13: Live orders for the admin, and remove the polling

**Files:**
- Modify: `ko_front/src/app/pages/admin/admin.ts`, `admin.html`, `admin.spec.ts`
- Delete: `ko_front/src/app/core/utils/poll.ts`

**Interfaces:**
- Consumes: `RealtimeService.events$`, `.reconnected$`; `upsertOrder` and `orderFromApi` (Task 12); `OrderService.getAll()` and `updateStatus()`.
- Produces: `AdminComponent.orders` updated by `order.created` / `order.updated` events; `statusOf`, `statusOverrides` and `dropConfirmedOverrides` no longer exist (an order's status is simply `order.status`).

- [ ] **Step 1: Rewrite the tests first** — in `ko_front/src/app/pages/admin/admin.spec.ts`:

1. Add near the other fakes (and the imports `Subject` from `rxjs`, `RealtimeService` from `../../core/services/realtime.service`, `ServerEvent` from `../../core/models/realtime.model`):

```ts
class FakeRealtime {
  events = new Subject<ServerEvent>();
  reconnected = new Subject<void>();
  events$ = this.events.asObservable();
  reconnected$ = this.reconnected.asObservable();
}

const apiOrder = (over: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 2,
  items: [{ product_id: 1, name: 'Mochi de Fresa', price: 3.5, quantity: 2 }],
  total: 7,
  pickup_name: 'Ana',
  pickup_phone: '600111222',
  pickup_time: '2026-09-22T18:00',
  status: 'pendiente',
  created_at: '2023-11-14T22:13:20',
  ...over,
});
```

2. In the top-level `beforeEach`, declare `let realtime: FakeRealtime;`, set `realtime = new FakeRealtime();` before `configureTestingModule`, and add `{ provide: RealtimeService, useValue: realtime },` to `providers`.

3. In the existing `filters and pagination` describe, the test `filters and paginates orders` creates its own component and reads `c.orderPages()` synchronously. Loading is now asynchronous, so make it wait and provide the fake realtime. Replace the lines from `orderService.getAll.mockReturnValue(of(orders));` through the first `expect(c.orderPages()).toBe(2);` with:

```ts
      orderService.getAll.mockReturnValue(of(orders));
      const f = TestBed.createComponent(AdminComponent);
      const c = f.componentInstance;
      await vi.waitFor(() => expect(c.orderPages()).toBe(2));
```

(The `TestBed` used there already has the providers from `beforeEach`, including the `RealtimeService` fake.)

4. Replace the whole `describe('live orders', …)` block with:

```ts
  describe('live orders', () => {
    it('loads the orders once over REST', async () => {
      orderService.getAll.mockReturnValue(of([SAMPLE_ORDER]));
      const c = TestBed.createComponent(AdminComponent).componentInstance;
      await vi.waitFor(() => expect(c.orders()).toHaveLength(1));
      expect(orderService.getAll).toHaveBeenCalledTimes(1);
    });

    it('adds an order placed by a customer as soon as the event arrives', async () => {
      orderService.getAll.mockReturnValue(of([SAMPLE_ORDER]));
      const c = TestBed.createComponent(AdminComponent).componentInstance;
      await vi.waitFor(() => expect(c.orders()).toHaveLength(1));

      realtime.events.next({
        type: 'order.created',
        order: apiOrder({ id: 2, created_at: '2023-11-15T10:00:00' }),
      } as ServerEvent);

      expect(c.orders().map(o => o.id)).toEqual([2, 1]);
    });

    it('applies a status change made elsewhere', async () => {
      orderService.getAll.mockReturnValue(of([SAMPLE_ORDER]));
      const c = TestBed.createComponent(AdminComponent).componentInstance;
      await vi.waitFor(() => expect(c.orders()).toHaveLength(1));

      realtime.events.next({ type: 'order.updated', order: apiOrder({ status: 'entregado' }) } as ServerEvent);

      expect(c.orders()[0].status).toBe('entregado');
    });

    it('reflects its own status change immediately, even if the socket is down', async () => {
      orderService.getAll.mockReturnValue(of([SAMPLE_ORDER]));
      const c = TestBed.createComponent(AdminComponent).componentInstance;
      await vi.waitFor(() => expect(c.orders()).toHaveLength(1));

      await c.changeStatus(c.orders()[0], 'listo');

      expect(orderService.updateStatus).toHaveBeenCalledWith(1, 'listo');
      expect(c.orders()[0].status).toBe('listo');
    });

    it('does not change the list when the status update fails', async () => {
      orderService.getAll.mockReturnValue(of([SAMPLE_ORDER]));
      orderService.updateStatus.mockRejectedValue(new Error('offline'));
      const c = TestBed.createComponent(AdminComponent).componentInstance;
      await vi.waitFor(() => expect(c.orders()).toHaveLength(1));

      await c.changeStatus(c.orders()[0], 'listo');

      expect(c.orders()[0].status).toBe('pendiente');
      expect(c.orderError()).toContain('offline');
    });

    it('reloads after a reconnection and keeps the last orders if that fails', async () => {
      orderService.getAll.mockReturnValueOnce(of([SAMPLE_ORDER])).mockReturnValueOnce(throwError(() => new Error('offline')));
      const c = TestBed.createComponent(AdminComponent).componentInstance;
      await vi.waitFor(() => expect(c.orders()).toHaveLength(1));

      realtime.reconnected.next();

      await vi.waitFor(() => expect(c.ordersLoadError()).toBe('offline'));
      expect(c.orders()).toHaveLength(1);
    });
  });
```

Also delete any leftover imports/uses of `vi.useFakeTimers` that only the old block needed (the `afterEach(() => vi.useRealTimers())` inside the removed describe goes with it).

- [ ] **Step 2: Run to verify it fails**

Run the frontend test command. Expected: FAIL — the new tests fail (no event handling in `AdminComponent`) and `statusOf` tests referenced elsewhere no longer exist.

- [ ] **Step 3: Implement** — in `ko_front/src/app/pages/admin/admin.ts`:

Imports: remove `import { pollWhileVisible } from '../../core/utils/poll';`; change the `takeUntilDestroyed` import line to stay as is; add

```ts
import { firstValueFrom } from 'rxjs';
import { RealtimeService } from '../../core/services/realtime.service';
import { upsertOrder } from '../../core/utils/orders';
```

and change `import { OrderService } from '../../core/services/order.service';` to `import { OrderService, orderFromApi } from '../../core/services/order.service';`.

Fields: add `private realtime = inject(RealtimeService);` next to the other `inject` fields, and delete the line

```ts
  private statusOverrides = signal<Record<number, OrderStatus>>({});
```

Replace the whole `constructor() { … }` (the one that calls `pollWhileVisible`) with:

```ts
  constructor() {
    void this.loadOrders();
    // Recarga al reconectar por si se perdió algún evento.
    this.realtime.reconnected$.pipe(takeUntilDestroyed()).subscribe(() => void this.loadOrders());
    // Los pedidos nuevos y los cambios de estado llegan al instante.
    this.realtime.events$.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event.type === 'order.created' || event.type === 'order.updated') {
        this.orders.update(list => upsertOrder(list, orderFromApi(event.order)));
      }
    });
  }

  private async loadOrders(): Promise<void> {
    try {
      this.orders.set(await firstValueFrom(this.orderService.getAll()));
      this.ordersLoadError.set('');
    } catch (e) {
      // Se conservan los últimos pedidos mostrados.
      this.ordersLoadError.set((e as { message?: string }).message ?? 'Error al cargar los pedidos');
    }
  }
```

Delete the methods `dropConfirmedOverrides` and `statusOf` (and their doc comment). In `filteredOrders`, change `this.statusOf(o) === status` to `o.status === status`. Replace `changeStatus` with:

```ts
  async changeStatus(order: Order, status: OrderStatus): Promise<void> {
    this.orderError.set('');
    try {
      await this.orderService.updateStatus(order.id, status);
      // Se refleja ya, aunque el websocket esté caído; el evento que llega después es idempotente.
      this.orders.update(list => upsertOrder(list, { ...order, status }));
    } catch (e: any) {
      this.orderError.set(e.message ?? 'Error al actualizar el pedido');
    }
  }
```

In `ko_front/src/app/pages/admin/admin.html`, replace every `statusOf(order)` with `order.status` (the `badge badge--…` class, the badge text, and the `[class.on]` binding on the status buttons).

Delete the file `ko_front/src/app/core/utils/poll.ts`.

- [ ] **Step 4: Run to verify it passes**

Run the frontend test command and the build. Expected: "Frontend green" (6 new live-order tests pass). Confirm nothing references the removed code:

```bash
grep -rn "pollWhileVisible\|statusOverrides\|statusOf\|utils/poll" ko_front/src || echo "sin referencias"
```

Expected: `sin referencias`.

- [ ] **Step 5: Manual smoke** — two browsers (admin and customer). Customer places an order: it appears in the admin "Pedidos" tab without reloading. Admin changes the state: the customer's "Mis pedidos" badge updates instantly. Stop the API for a few seconds and restart it: both pages reconnect on their own and reload their lists.

- [ ] **Step 6: Commit**

```bash
git add ko_front/src/app/pages/admin ko_front/src/app/core/utils/poll.ts
git commit -m "feat(frontend): admin orders update live via websocket; remove polling" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

### Task 13b: Final verification and merge `feat/ws-orders`

- [ ] **Step 1:** backend `uv run pytest -q` green; frontend green; restart the API and run the smoke scenarios of Tasks 8, 10 and 13 once more end to end (customer chat → admin reply → order status change → API restart).
- [ ] **Step 2: Merge**

```bash
git checkout dev
git merge --no-ff feat/ws-orders -m "Merge feat/ws-orders into dev" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 3:** Ask the user whether to push `dev` and the feature branches. Remind them that the API must run as a **single process** (in-memory connection registry) and that `uvicorn` in dev runs without `--reload`.

---

## Self-review against the spec

| Spec section | Task |
|---|---|
| Architecture, one connection per user | 2, 3 |
| Data model `chat_message`, read semantics | 4 |
| Handshake, close codes 4401/4403, Origin rule, role from DB | 2 |
| Rate limit, `bad_request` / `unknown_type` | 2 |
| `chat.send` / `chat.read`, thread rules, recipients | 6 |
| REST endpoints | 5 |
| Order events over REST publishing | 11 |
| Backend components (`realtime.py`, `ws.py`, models, services) | 1, 2, 4, 5, 6 |
| `RealtimeService` (backoff, 4401, reconnected) | 3 |
| `ChatService` (dedupe, unread, send-while-closed) | 7, 9 |
| Chat widget (customers only, badge, offline, Escape) | 8 |
| Admin Chat tab (list, unread, reply, reorder) | 9, 10 |
| Live orders, polling and `statusOverrides` removed | 12, 13 |
| Offline behavior (recipient offline keeps the message) | 6 (`test_message_to_an_offline_admin…`) |
| Errors, testing strategy | covered in each task's tests |
| One branch per feature | Branches 1–5 |

No placeholders remain; type and method names are consistent across tasks (`send_to_user`/`send_to_admins`, `WsUser`, `WsError`, `HANDLERS`, `ServerEvent`, `ChatService.sendTo`/`markReadFor`/`openThread`/`closeThread`, `upsertOrder`, `orderFromApi`).
