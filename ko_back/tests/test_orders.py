from app.models.product import Product, ProductCategory


def _auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _seed_product(db_session, price: float = 3.5) -> Product:
    product = Product(name="Mochi", price=price, description="d", emoji="🍡", category=ProductCategory.MOCHI)
    db_session.add(product)
    db_session.commit()
    return product


def test_create_order_computes_total_from_product_price(client, customer_token, db_session) -> None:
    product = _seed_product(db_session, price=3.5)
    response = client.post(
        "/orders",
        json={
            "items": [{"product_id": product.id, "quantity": 2}],
            "pickup_name": "Ana",
            "pickup_phone": "600111222",
            "pickup_time": "Hoy 18:00",
        },
        headers=_auth_header(customer_token),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["total"] == 7.0
    assert body["items"][0]["name"] == "Mochi"
    assert body["items"][0]["price"] == 3.5


def test_create_order_ignores_any_client_supplied_price_or_name(client, customer_token, db_session) -> None:
    product = _seed_product(db_session, price=3.5)
    response = client.post(
        "/orders",
        json={
            "items": [{"product_id": product.id, "quantity": 1, "price": 999, "name": "hack"}],
            "pickup_name": "Ana",
            "pickup_phone": "600111222",
            "pickup_time": "Hoy 18:00",
        },
        headers=_auth_header(customer_token),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["total"] == 3.5
    assert body["items"][0]["price"] == 3.5


def test_create_order_with_unknown_product_returns_404(client, customer_token) -> None:
    response = client.post(
        "/orders",
        json={
            "items": [{"product_id": 999, "quantity": 1}],
            "pickup_name": "Ana",
            "pickup_phone": "600111222",
            "pickup_time": "Hoy 18:00",
        },
        headers=_auth_header(customer_token),
    )
    assert response.status_code == 404


def test_create_order_unauthenticated_returns_401(client, db_session) -> None:
    product = _seed_product(db_session)
    response = client.post(
        "/orders",
        json={
            "items": [{"product_id": product.id, "quantity": 1}],
            "pickup_name": "Ana",
            "pickup_phone": "600111222",
            "pickup_time": "Hoy 18:00",
        },
    )
    assert response.status_code == 401


def test_create_order_with_zero_quantity_returns_422(client, customer_token, db_session) -> None:
    product = _seed_product(db_session)
    response = client.post(
        "/orders",
        json={
            "items": [{"product_id": product.id, "quantity": 0}],
            "pickup_name": "Ana",
            "pickup_phone": "600111222",
            "pickup_time": "Hoy 18:00",
        },
        headers=_auth_header(customer_token),
    )
    assert response.status_code == 422


def test_create_order_with_no_items_returns_422(client, customer_token) -> None:
    response = client.post(
        "/orders",
        json={"items": [], "pickup_name": "Ana", "pickup_phone": "600111222", "pickup_time": "Hoy 18:00"},
        headers=_auth_header(customer_token),
    )
    assert response.status_code == 422


def test_list_orders_as_admin_sees_all_users_orders(client, admin_token, customer_token, db_session) -> None:
    product = _seed_product(db_session)
    client.post(
        "/orders",
        json={
            "items": [{"product_id": product.id, "quantity": 1}],
            "pickup_name": "Ana",
            "pickup_phone": "600111222",
            "pickup_time": "Hoy 18:00",
        },
        headers=_auth_header(customer_token),
    )
    response = client.get("/orders", headers=_auth_header(admin_token))
    assert response.status_code == 200
    assert len(response.json()) == 1


def test_list_orders_as_customer_sees_only_own_orders(client, customer_token, db_session) -> None:
    product = _seed_product(db_session)
    client.post(
        "/orders",
        json={
            "items": [{"product_id": product.id, "quantity": 1}],
            "pickup_name": "Ana",
            "pickup_phone": "600111222",
            "pickup_time": "Hoy 18:00",
        },
        headers=_auth_header(customer_token),
    )
    other_response = client.post("/auth/register", json={"email": "otro@test.com", "password": "secret123"})
    other_token = other_response.json()["access_token"]
    client.post(
        "/orders",
        json={
            "items": [{"product_id": product.id, "quantity": 1}],
            "pickup_name": "Otro",
            "pickup_phone": "600333444",
            "pickup_time": "Hoy 19:00",
        },
        headers=_auth_header(other_token),
    )
    response = client.get("/orders", headers=_auth_header(customer_token))
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["pickup_name"] == "Ana"


def test_get_order_as_owner_returns_200(client, customer_token, db_session) -> None:
    product = _seed_product(db_session)
    create_response = client.post(
        "/orders",
        json={
            "items": [{"product_id": product.id, "quantity": 1}],
            "pickup_name": "Ana",
            "pickup_phone": "600111222",
            "pickup_time": "Hoy 18:00",
        },
        headers=_auth_header(customer_token),
    )
    order_id = create_response.json()["id"]
    response = client.get(f"/orders/{order_id}", headers=_auth_header(customer_token))
    assert response.status_code == 200


def test_get_order_as_admin_returns_200(client, admin_token, customer_token, db_session) -> None:
    product = _seed_product(db_session)
    create_response = client.post(
        "/orders",
        json={
            "items": [{"product_id": product.id, "quantity": 1}],
            "pickup_name": "Ana",
            "pickup_phone": "600111222",
            "pickup_time": "Hoy 18:00",
        },
        headers=_auth_header(customer_token),
    )
    order_id = create_response.json()["id"]
    response = client.get(f"/orders/{order_id}", headers=_auth_header(admin_token))
    assert response.status_code == 200


def test_get_order_as_different_customer_returns_404(client, customer_token, db_session) -> None:
    product = _seed_product(db_session)
    create_response = client.post(
        "/orders",
        json={
            "items": [{"product_id": product.id, "quantity": 1}],
            "pickup_name": "Ana",
            "pickup_phone": "600111222",
            "pickup_time": "Hoy 18:00",
        },
        headers=_auth_header(customer_token),
    )
    order_id = create_response.json()["id"]
    other_response = client.post("/auth/register", json={"email": "otro@test.com", "password": "secret123"})
    other_token = other_response.json()["access_token"]
    response = client.get(f"/orders/{order_id}", headers=_auth_header(other_token))
    assert response.status_code == 404


def test_get_order_missing_id_returns_404(client, customer_token) -> None:
    response = client.get("/orders/999", headers=_auth_header(customer_token))
    assert response.status_code == 404
