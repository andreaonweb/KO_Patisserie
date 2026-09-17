from datetime import datetime, timedelta, timezone

import jwt

from app.core.config import settings
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


def test_me_with_valid_token_returns_current_user(client) -> None:
    register_response = client.post("/auth/register", json={"email": "ana@test.com", "password": "secret123"})
    token = register_response.json()["access_token"]
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "ana@test.com"
    assert body["role"] == "customer"


def test_me_without_token_returns_401(client) -> None:
    response = client.get("/auth/me")
    assert response.status_code == 401


def test_me_with_garbage_token_returns_401(client) -> None:
    response = client.get("/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert response.status_code == 401


def test_me_with_expired_token_returns_401(client, db_session) -> None:
    client.post("/auth/register", json={"email": "ana@test.com", "password": "secret123"})
    user = db_session.query(User).filter(User.email == "ana@test.com").first()
    expired_payload = {
        "sub": str(user.id),
        "role": "customer",
        "exp": datetime.now(timezone.utc) - timedelta(days=1),
    }
    expired_token = jwt.encode(expired_payload, settings.jwt_secret, algorithm="HS256")
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {expired_token}"})
    assert response.status_code == 401
