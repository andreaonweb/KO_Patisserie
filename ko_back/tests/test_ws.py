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


def test_binary_frame_returns_bad_request_and_keeps_the_socket(client, customer_token) -> None:
    with client.websocket_connect("/ws") as ws:
        _auth(ws, customer_token)
        ws.receive_json()
        ws.send_bytes(b"\x00\x01")
        assert ws.receive_json()["code"] == "bad_request"
        ws.send_json({"type": "nope"})
        assert ws.receive_json()["code"] == "unknown_type"


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
