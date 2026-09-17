import jwt
import pytest

from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.models.user import User, UserRole


def test_hash_password_differs_from_plaintext() -> None:
    hashed = hash_password("secret123")
    assert hashed != "secret123"


def test_verify_password_accepts_correct_password() -> None:
    hashed = hash_password("secret123")
    assert verify_password("secret123", hashed) is True


def test_verify_password_rejects_wrong_password() -> None:
    hashed = hash_password("secret123")
    assert verify_password("wrong-password", hashed) is False


def test_create_and_decode_access_token_round_trips() -> None:
    user = User(id=1, email="ana@test.com", role=UserRole.CUSTOMER)
    token = create_access_token(user)
    payload = decode_access_token(token)
    assert payload["sub"] == "1"
    assert payload["role"] == "customer"


def test_decode_access_token_rejects_tampered_token() -> None:
    user = User(id=1, email="ana@test.com", role=UserRole.CUSTOMER)
    token = create_access_token(user)
    tampered = token[:-1] + ("a" if token[-1] != "a" else "b")
    with pytest.raises(jwt.PyJWTError):
        decode_access_token(tampered)
