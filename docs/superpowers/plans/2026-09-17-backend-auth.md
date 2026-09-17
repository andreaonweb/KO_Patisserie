# Backend Auth (ko_back) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `ko_back` real authentication — register/login/me over JWT, with a `role` (`admin`/`customer`) baked into every token — so later sub-projects (product/order CRUD, and the Angular app swapping Firebase for this API) have a real identity and role to build on.

**Architecture:** Three new FastAPI routes under `/auth` (`register`, `login`, `me`) backed by the existing `User` SQLAlchemy model (already has `hashed_password` and `role`). Passwords hashed with `bcrypt`; identity carried as a signed JWT (`PyJWT`, HS256, 7-day expiry) validated by a reusable `get_current_user` FastAPI dependency. An idempotent script seeds one admin account so the admin login path is testable today.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2.0, `bcrypt`, `PyJWT`, `pytest` + `httpx` (`TestClient`), `uv`.

**Spec:** `docs/superpowers/specs/2026-09-17-backend-auth-design.md`

## Global Constraints

- Passwords hashed with `bcrypt`. Never store or log plaintext passwords.
- JWT: HS256, signed with `settings.jwt_secret`, payload `{sub: str(user.id), role: user.role.value, exp}`, 7-day expiry. No refresh tokens.
- `POST /auth/register` always creates `role=CUSTOMER`, regardless of request body content — no public path to create admins.
- `POST /auth/login` returns a generic 401 on any failure (wrong password or unknown email use the same message) — never reveal whether the email exists.
- `GET /auth/me` (and any future protected route via `get_current_user`) returns 401 for a missing, malformed, or expired token.
- CORS allowed origin: `http://localhost:4200` only.
- Admin seed credentials are fixed: `admin@email.com` / `admin123` (matches the old Firebase demo account).
- No comments in code. Fully type-annotated. No service/repository layer — three routes don't justify one yet.
- All commands below run from inside `ko_back/`.

---

### Task 1: Auth dependencies + JWT setting

**Files:**
- Modify: `ko_back/pyproject.toml` (via `uv add`, not hand-edited)
- Modify: `ko_back/.env.example`
- Modify: `ko_back/.env`
- Modify: `ko_back/app/core/config.py`
- Test: `ko_back/tests/test_config.py`

**Interfaces:**
- Produces: `Settings.jwt_secret: str` (read from `JWT_SECRET` env var, default `"dev-secret-change-in-production"`) — consumed by Task 2's `security.py`.

- [ ] **Step 1: Add the new dependencies**

Run: `uv add bcrypt pyjwt`
Expected: `pyproject.toml` gains `bcrypt` and `pyjwt` under `[project.dependencies]`; `uv.lock` is updated.

- [ ] **Step 2: Write the failing tests**

Append to `ko_back/tests/test_config.py`:

```python
def test_settings_default_jwt_secret() -> None:
    assert Settings().jwt_secret == "dev-secret-change-in-production"


def test_settings_reads_jwt_secret_from_env(monkeypatch) -> None:
    monkeypatch.setenv("JWT_SECRET", "super-secret-value")
    assert Settings().jwt_secret == "super-secret-value"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_config.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'jwt_secret'`

- [ ] **Step 4: Add the setting**

In `ko_back/app/core/config.py`, add the field to the `Settings` class:

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+psycopg://ko:ko@localhost:5434/ko_patisserie"
    jwt_secret: str = "dev-secret-change-in-production"
```

- [ ] **Step 5: Update `.env.example` and `.env`**

`ko_back/.env.example`:

```
DATABASE_URL=postgresql+psycopg://ko:ko@localhost:5434/ko_patisserie
JWT_SECRET=dev-secret-change-in-production
```

`ko_back/.env` (same value locally — this file is gitignored):

```
DATABASE_URL=postgresql+psycopg://ko:ko@localhost:5434/ko_patisserie
JWT_SECRET=dev-secret-change-in-production
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/test_config.py -v`
Expected: PASS (4 tests total: 2 existing + 2 new)

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml uv.lock .env.example app/core/config.py tests/test_config.py
git commit -m "feat(backend): add JWT secret setting and auth dependencies"
```

---

### Task 2: Password hashing + JWT helpers

**Files:**
- Create: `ko_back/app/core/security.py`
- Test: `ko_back/tests/test_security.py`

**Interfaces:**
- Consumes: `Settings.jwt_secret` (Task 1), `app.models.user.User`, `app.models.user.UserRole`.
- Produces: `hash_password(password: str) -> str`, `verify_password(password: str, hashed_password: str) -> bool`, `create_access_token(user: User) -> str`, `decode_access_token(token: str) -> dict` (raises `jwt.PyJWTError` subclasses on invalid/expired tokens) — consumed by Task 3 (register/login) and Task 4 (`get_current_user`).

- [ ] **Step 1: Write the failing tests**

Create `ko_back/tests/test_security.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_security.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.core.security'`

- [ ] **Step 3: Write the implementation**

Create `ko_back/app/core/security.py`:

```python
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.core.config import settings
from app.models.user import User

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed_password.encode("utf-8"))


def create_access_token(user: User) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    payload = {"sub": str(user.id), "role": user.role.value, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_security.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add app/core/security.py tests/test_security.py
git commit -m "feat(backend): add password hashing and JWT helpers"
```

---

### Task 3: Register + login endpoints

**Files:**
- Create: `ko_back/app/schemas/__init__.py`
- Create: `ko_back/app/schemas/auth.py`
- Create: `ko_back/app/api/__init__.py`
- Create: `ko_back/app/api/auth.py`
- Modify: `ko_back/app/main.py`
- Modify: `ko_back/tests/conftest.py`
- Create: `ko_back/tests/test_auth.py`

**Interfaces:**
- Consumes: `hash_password`, `verify_password`, `create_access_token` (Task 2), `app.core.database.get_db`, `app.models.user.User`, `app.models.user.UserRole`.
- Produces: `RegisterRequest {email: str, password: str}`, `LoginRequest {email: str, password: str}`, `TokenResponse {access_token: str, token_type: str}`, mounted router `auth_router` with `POST /auth/register`, `POST /auth/login` — consumed by Task 4 (`/auth/me` is added to the same router). `client` pytest fixture in `conftest.py` (a `TestClient` with `get_db` overridden to the test `db_session`) — consumed by Task 4's tests too.

- [ ] **Step 1: Write the failing tests**

Create `ko_back/tests/test_auth.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_auth.py -v`
Expected: FAIL — `fixture 'client' not found`

- [ ] **Step 3: Add the `client` fixture to `conftest.py`**

Replace the full contents of `ko_back/tests/conftest.py`:

```python
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import Base, get_db
from app.main import app
import app.models  # noqa: F401


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def client(db_session: Session) -> Generator[TestClient, None, None]:
    def override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()
```

- [ ] **Step 4: Write the schemas**

Create `ko_back/app/schemas/__init__.py` (empty file).

Create `ko_back/app/schemas/auth.py`:

```python
from pydantic import BaseModel

from app.models.user import UserRole


class RegisterRequest(BaseModel):
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: int
    email: str
    role: UserRole
```

- [ ] **Step 5: Write the router**

Create `ko_back/app/api/__init__.py` (empty file).

Create `ko_back/app/api/auth.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User, UserRole
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
def register(body: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    existing = db.query(User).filter(User.email == body.email).first()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El email ya está registrado")
    user = User(email=body.email, hashed_password=hash_password(body.password), role=UserRole.CUSTOMER)
    db.add(user)
    db.commit()
    db.refresh(user)
    return TokenResponse(access_token=create_access_token(user))


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.query(User).filter(User.email == body.email).first()
    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas")
    return TokenResponse(access_token=create_access_token(user))
```

- [ ] **Step 6: Wire the router and CORS into `main.py`**

Replace the full contents of `ko_back/app/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router

app = FastAPI(title="Ko Pâtisserie API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `uv run pytest tests/test_auth.py -v`
Expected: PASS (6 tests)

Run: `uv run pytest -v`
Expected: PASS (all tests in the suite, no regressions)

- [ ] **Step 8: Commit**

```bash
git add app/schemas app/api app/main.py tests/conftest.py tests/test_auth.py
git commit -m "feat(backend): add register and login endpoints"
```

---

### Task 4: `get_current_user` dependency + `/auth/me`

**Files:**
- Create: `ko_back/app/core/deps.py`
- Modify: `ko_back/app/api/auth.py`
- Modify: `ko_back/tests/test_auth.py`

**Interfaces:**
- Consumes: `decode_access_token` (Task 2), `app.core.database.get_db`, `app.models.user.User`, `client`/`db_session` fixtures (Task 3).
- Produces: `get_current_user(credentials, db) -> User` — consumed by `GET /auth/me` here, and reusable later by sub-project 3's admin-only product/order routes (outside this plan).

- [ ] **Step 1: Write the failing tests**

Append to `ko_back/tests/test_auth.py`:

```python
import jwt
from datetime import datetime, timedelta, timezone

from app.core.config import settings


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_auth.py -v`
Expected: FAIL — 4 new tests error with 404 (route `/auth/me` doesn't exist yet)

- [ ] **Step 3: Write the dependency**

Create `ko_back/app/core/deps.py`:

```python
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No autenticado")
    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido")
    user = db.get(User, int(payload["sub"]))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido")
    return user
```

- [ ] **Step 4: Add the `/me` route**

In `ko_back/app/api/auth.py`, add the import and route:

```python
from app.core.deps import get_current_user
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserResponse
```

(replaces the existing `from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse` import line)

```python
@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse(id=current_user.id, email=current_user.email, role=current_user.role)
```

(appended at the end of the file)

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_auth.py -v`
Expected: PASS (10 tests)

Run: `uv run pytest -v`
Expected: PASS (all tests, no regressions)

- [ ] **Step 6: Commit**

```bash
git add app/core/deps.py app/api/auth.py tests/test_auth.py
git commit -m "feat(backend): add get_current_user dependency and /auth/me"
```

---

### Task 5: Admin seed script

**Files:**
- Create: `ko_back/app/scripts/__init__.py`
- Create: `ko_back/app/scripts/seed_admin.py`
- Test: `ko_back/tests/test_seed_admin.py`

**Interfaces:**
- Consumes: `hash_password` (Task 2), `app.core.database.SessionLocal`, `app.models.user.User`, `app.models.user.UserRole`.
- Produces: `seed_admin(db: Session) -> None` (pure, idempotent), `main() -> None` (CLI entry point using `SessionLocal`).

- [ ] **Step 1: Write the failing tests**

Create `ko_back/tests/test_seed_admin.py`:

```python
from app.models.user import User, UserRole
from app.scripts.seed_admin import ADMIN_EMAIL, seed_admin


def test_seed_admin_creates_admin_user(db_session) -> None:
    seed_admin(db_session)
    admins = db_session.query(User).filter(User.email == ADMIN_EMAIL).all()
    assert len(admins) == 1
    assert admins[0].role == UserRole.ADMIN


def test_seed_admin_is_idempotent(db_session) -> None:
    seed_admin(db_session)
    seed_admin(db_session)
    admins = db_session.query(User).filter(User.email == ADMIN_EMAIL).all()
    assert len(admins) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_seed_admin.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.scripts'`

- [ ] **Step 3: Write the implementation**

Create `ko_back/app/scripts/__init__.py` (empty file).

Create `ko_back/app/scripts/seed_admin.py`:

```python
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.user import User, UserRole

ADMIN_EMAIL = "admin@email.com"
ADMIN_PASSWORD = "admin123"


def seed_admin(db: Session) -> None:
    existing = db.query(User).filter(User.email == ADMIN_EMAIL).first()
    if existing is not None:
        return
    admin = User(email=ADMIN_EMAIL, hashed_password=hash_password(ADMIN_PASSWORD), role=UserRole.ADMIN)
    db.add(admin)
    db.commit()


def main() -> None:
    db = SessionLocal()
    try:
        seed_admin(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_seed_admin.py -v`
Expected: PASS (2 tests)

Run: `uv run pytest -v`
Expected: PASS (all tests, no regressions)

- [ ] **Step 5: Commit**

```bash
git add app/scripts tests/test_seed_admin.py
git commit -m "feat(backend): add idempotent admin seed script"
```

---

### Task 6: Manual acceptance run

**Files:** none (verification only, no commit)

- [ ] **Step 1: Start Postgres**

Run: `docker compose up -d`
Expected: `ko_back-postgres-1` running

- [ ] **Step 2: Confirm the schema is current**

Run: `uv run alembic upgrade head`
Expected: no pending migrations reported (already at `0001`)

- [ ] **Step 3: Seed the admin account**

Run: `uv run python -m app.scripts.seed_admin`
Expected: exits cleanly, no output

Run it again to confirm idempotency: `uv run python -m app.scripts.seed_admin`
Expected: exits cleanly, still no duplicate row (checked in Step 6)

- [ ] **Step 4: Start the API**

Run (background): `uv run uvicorn app.main:app --reload`
Expected: `Application startup complete`, listening on `http://127.0.0.1:8000`

- [ ] **Step 5: Exercise the flow with curl**

```bash
curl -s -X POST http://127.0.0.1:8000/auth/register -H "Content-Type: application/json" -d '{"email":"cliente@test.com","password":"secret123"}'
```
Expected: `{"access_token":"...","token_type":"bearer"}`

```bash
curl -s -X POST http://127.0.0.1:8000/auth/login -H "Content-Type: application/json" -d '{"email":"admin@email.com","password":"admin123"}'
```
Expected: `{"access_token":"...","token_type":"bearer"}` — copy this `access_token` for the next step.

```bash
curl -s http://127.0.0.1:8000/auth/me -H "Authorization: Bearer <access_token from previous step>"
```
Expected: `{"id":<n>,"email":"admin@email.com","role":"admin"}`

- [ ] **Step 6: Confirm the admin seed didn't duplicate**

```bash
docker compose exec postgres psql -U ko -d ko_patisserie -c "SELECT email, role FROM \"user\" WHERE email = 'admin@email.com';"
```
Expected: exactly one row, `role = admin`

---

## Self-Review Notes

- Spec coverage: register/login/me ✅ (Tasks 3-4), password hashing + JWT ✅ (Task 2), `get_current_user` reusable dependency ✅ (Task 4), CORS ✅ (Task 3 Step 6), admin seed ✅ (Task 5), JWT settings ✅ (Task 1), manual acceptance ✅ (Task 6). Non-goals (password reset, refresh tokens, product/order endpoints, frontend changes) correctly have no task.
- Type/name consistency checked: `create_access_token(user: User) -> str` and `decode_access_token(token: str) -> dict` (Task 2) are called with matching signatures in Task 3 (`create_access_token(user)`) and Task 4 (`decode_access_token(credentials.credentials)`). `get_current_user` (Task 4) matches its use in `me()` (Task 4). `seed_admin(db: Session) -> None` (Task 5) matches its test calls.
