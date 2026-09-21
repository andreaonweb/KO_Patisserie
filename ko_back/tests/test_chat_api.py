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
