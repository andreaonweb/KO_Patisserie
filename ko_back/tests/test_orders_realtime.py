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
