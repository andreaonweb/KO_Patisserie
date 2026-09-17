from app.models.user import User, UserRole


def test_register_returns_token(client) -> None:
    response = client.post("/auth/register", json={"email": "ana@test.com", "password": "secret123"})
    assert response.status_code == 200
    body = response.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"


def test_register_creates_customer_role_even_if_body_says_otherwise(client, db_session) -> None:
    client.post(
        "/auth/register",
        json={"email": "ana@test.com", "password": "secret123", "role": "admin"},
    )
    user = db_session.query(User).filter(User.email == "ana@test.com").first()
    assert user.role == UserRole.CUSTOMER


def test_register_with_existing_email_returns_409(client) -> None:
    client.post("/auth/register", json={"email": "ana@test.com", "password": "secret123"})
    response = client.post("/auth/register", json={"email": "ana@test.com", "password": "other-pass"})
    assert response.status_code == 409


def test_login_with_correct_credentials_returns_token(client) -> None:
    client.post("/auth/register", json={"email": "ana@test.com", "password": "secret123"})
    response = client.post("/auth/login", json={"email": "ana@test.com", "password": "secret123"})
    assert response.status_code == 200
    assert "access_token" in response.json()


def test_login_with_wrong_password_returns_401(client) -> None:
    client.post("/auth/register", json={"email": "ana@test.com", "password": "secret123"})
    response = client.post("/auth/login", json={"email": "ana@test.com", "password": "wrong-password"})
    assert response.status_code == 401


def test_login_with_unknown_email_returns_401(client) -> None:
    response = client.post("/auth/login", json={"email": "nobody@test.com", "password": "secret123"})
    assert response.status_code == 401
