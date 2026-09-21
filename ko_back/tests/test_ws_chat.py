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
