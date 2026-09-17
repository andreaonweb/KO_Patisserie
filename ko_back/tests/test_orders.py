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
