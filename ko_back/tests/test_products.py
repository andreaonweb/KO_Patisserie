from app.models.product import Product, ProductCategory


def _auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_list_products_empty(client) -> None:
    response = client.get("/products")
    assert response.status_code == 200
    assert response.json() == []


def test_list_products_returns_seeded_rows(client, db_session) -> None:
    db_session.add(Product(name="Mochi", price=3.5, description="d", emoji="🍡", category=ProductCategory.MOCHI))
    db_session.commit()
    response = client.get("/products")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["name"] == "Mochi"


def test_create_product_as_admin_returns_201(client, admin_token) -> None:
    response = client.post(
        "/products",
        json={"name": "Mochi", "price": 3.5, "description": "d", "emoji": "🍡", "category": "mochi"},
        headers=_auth_header(admin_token),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Mochi"
    assert body["is_new"] is False


def test_create_product_as_customer_returns_403(client, customer_token) -> None:
    response = client.post(
        "/products",
        json={"name": "Mochi", "price": 3.5, "description": "d", "emoji": "🍡", "category": "mochi"},
        headers=_auth_header(customer_token),
    )
    assert response.status_code == 403


def test_create_product_unauthenticated_returns_401(client) -> None:
    response = client.post(
        "/products",
        json={"name": "Mochi", "price": 3.5, "description": "d", "emoji": "🍡", "category": "mochi"},
    )
    assert response.status_code == 401


def test_update_product_as_admin_returns_200(client, admin_token, db_session) -> None:
    product = Product(name="Mochi", price=3.5, description="d", emoji="🍡", category=ProductCategory.MOCHI)
    db_session.add(product)
    db_session.commit()
    response = client.put(
        f"/products/{product.id}",
        json={
            "name": "Mochi Matcha",
            "price": 4.0,
            "description": "d2",
            "emoji": "🍵",
            "category": "mochi",
            "is_new": True,
        },
        headers=_auth_header(admin_token),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Mochi Matcha"
    assert body["is_new"] is True


def test_update_product_missing_id_returns_404(client, admin_token) -> None:
    response = client.put(
        "/products/999",
        json={"name": "X", "price": 1.0, "description": "d", "emoji": "🍡", "category": "mochi"},
        headers=_auth_header(admin_token),
    )
    assert response.status_code == 404


def test_update_product_as_customer_returns_403(client, customer_token, db_session) -> None:
    product = Product(name="Mochi", price=3.5, description="d", emoji="🍡", category=ProductCategory.MOCHI)
    db_session.add(product)
    db_session.commit()
    response = client.put(
        f"/products/{product.id}",
        json={"name": "X", "price": 1.0, "description": "d", "emoji": "🍡", "category": "mochi"},
        headers=_auth_header(customer_token),
    )
    assert response.status_code == 403


def test_delete_product_as_admin_returns_204(client, admin_token, db_session) -> None:
    product = Product(name="Mochi", price=3.5, description="d", emoji="🍡", category=ProductCategory.MOCHI)
    db_session.add(product)
    db_session.commit()
    response = client.delete(f"/products/{product.id}", headers=_auth_header(admin_token))
    assert response.status_code == 204
    follow_up = client.get("/products")
    assert follow_up.json() == []


def test_delete_product_missing_id_returns_404(client, admin_token) -> None:
    response = client.delete("/products/999", headers=_auth_header(admin_token))
    assert response.status_code == 404


def test_delete_product_as_customer_returns_403(client, customer_token, db_session) -> None:
    product = Product(name="Mochi", price=3.5, description="d", emoji="🍡", category=ProductCategory.MOCHI)
    db_session.add(product)
    db_session.commit()
    response = client.delete(f"/products/{product.id}", headers=_auth_header(customer_token))
    assert response.status_code == 403
