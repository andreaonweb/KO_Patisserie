# Backend Auth (ko_back) — Design

## Context

Continuation of the Firebase → custom backend migration started in
[2026-09-16-monorepo-backend-base-design.md](2026-09-16-monorepo-backend-base-design.md)
(sub-project 1: empty `ko_back` skeleton, `User`/`Product`/`Order` models,
no routes beyond `/health`). This is **sub-project 2**: real authentication
in `ko_back` — registration, login, JWT issuance, and a reusable
"current user" dependency that sub-project 3 (product/order CRUD) and
sub-project 4 (Angular swapping Firebase for this API) will build on.

The end goal driving this: the Angular navbar/footer need two distinct
login entry points (client login in the navbar, admin login behind a
footer "Intranet" button) with real role-based UI. That UI work is
sub-project 4 and is **not** part of this spec — this spec only makes the
role real on the backend so sub-project 4 has something correct to call.

## Goals

- `POST /auth/register` — email + password, always creates a
  `role=CUSTOMER` user (no public path to create admins). Returns a JWT.
- `POST /auth/login` — email + password, works for both roles. Returns a
  JWT.
- `GET /auth/me` — Bearer JWT → `{id, email, role}`.
- `get_current_user` FastAPI dependency (`app/core/deps.py`), decodes the
  JWT and loads the `User` row — reusable by sub-project 3 to protect
  admin-only endpoints.
- Passwords hashed with `bcrypt`. JWTs signed HS256 via `PyJWT`, 7-day
  expiry, payload `{sub: user.id, role: user.role, exp}`.
- CORS enabled for `http://localhost:4200` so the Angular dev server can
  call this API.
- Idempotent seed script creating `admin@email.com` / `admin123`
  (`role=ADMIN`) — same credentials as the old Firebase demo-account
  filler, so the admin login flow is testable end-to-end in this
  sub-project already.

## Non-goals

- Password reset / forgot-password flow — not present in the current
  Firebase setup either; no regression.
- Refresh tokens — a single 7-day access token is enough for this app's
  size; revisit only if it becomes a real problem.
- Product/Order endpoints, or protecting them by role — sub-project 3.
- Any change to the Angular app — it keeps talking to Firebase until
  sub-project 4. This sub-project is backend-only.
- Rate limiting / account lockout on login attempts.

## Architecture

**New dependencies** (`pyproject.toml`): `bcrypt`, `pyjwt`.

**`app/core/config.py`:** add `jwt_secret: str` to `Settings`, read from
`JWT_SECRET` env var with a dev-only default (same pattern as
`database_url`'s default) so `.env.example` documents it but local dev
works out of the box.

**`app/core/security.py`** (new): `hash_password`, `verify_password`
(wrap `bcrypt`), `create_access_token(user)`, `decode_access_token(token)`
(wrap `PyJWT`, HS256, `settings.jwt_secret`).

**`app/core/deps.py`** (new): `get_current_user(credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()), db: Session = Depends(get_db)) -> User`,
raises `401` on missing/invalid/expired token or unknown `sub`. Uses
FastAPI's `HTTPBearer` (not `OAuth2PasswordBearer`) purely as the
Authorization-header extractor, since login is a plain JSON
`{email, password}` body, not an OAuth2 form-encoded request.

**`app/schemas/auth.py`** (new, Pydantic): `RegisterRequest {email, password}`,
`LoginRequest {email, password}`, `TokenResponse {access_token, token_type}`,
`UserResponse {id, email, role}`.

**`app/api/auth.py`** (new, `APIRouter(prefix="/auth")`):
- `register`: 409 if email exists; else hash password, insert
  `User(role=CUSTOMER)`, return `TokenResponse`.
- `login`: look up by email, `verify_password`; `401` with a generic
  "credenciales inválidas" message on any failure (don't reveal whether
  the email exists); else return `TokenResponse`.
- `me`: `Depends(get_current_user)` → `UserResponse`.

**`app/main.py`:** add `CORSMiddleware` (`allow_origins=["http://localhost:4200"]`,
`allow_methods=["*"]`, `allow_headers=["*"]`); `app.include_router(auth_router)`.

**`app/scripts/seed_admin.py`** (new): standalone script using
`SessionLocal` directly — checks for `admin@email.com`, inserts it with
`role=ADMIN` if missing, no-ops otherwise. Run manually:
`uv run python -m app.scripts.seed_admin`.

No new Alembic migration — the `User` table (with `role`) already exists
from sub-project 1.

## Testing

TDD, pytest + `TestClient`. `conftest.py` gets a new fixture that
overrides the `get_db` FastAPI dependency with the existing in-memory
SQLite `db_session`, so `TestClient` requests hit the test database.

Cases:
- register → 200, returns a token; the created user has `role=CUSTOMER`
  even if the request body is tampered with.
- register with an existing email → 409.
- login with correct credentials → 200, token.
- login with wrong password / unknown email → 401 (same message either way).
- `/auth/me` with a valid token → 200, correct `{id, email, role}`.
- `/auth/me` with no token / garbage token / expired token → 401.
- `seed_admin.py` run twice → still exactly one admin row (idempotency
  check via direct DB assertion, not an HTTP test).

Manual acceptance: `docker compose up -d`, `uv run python -m app.scripts.seed_admin`,
`uv run uvicorn app.main:app --reload`, then `curl` register/login/me by
hand and confirm the JWT round-trips.

## Branch / workflow

One branch per implementation task, each cut from the current tip of
`dev` (`feat/backend-auth-<slug>`), merged into `dev` as soon as that
task's review is clean, branch deleted, next task branches from the
updated `dev` — incremental integration rather than one long-lived
branch for the whole sub-project. See the plan's Execution Workflow
section for the exact sequence.

## Code style

No comments. Fully type-annotated. No service/repository layer yet —
three routes is not enough duplication to justify one; revisit in
sub-project 3 if `app/api/products.py` / `app/api/orders.py` start
repeating the same query patterns.

## Open items resolved during brainstorming

- Data migration strategy: full move to Postgres for auth *and* data
  (products/orders), not a Firebase-custom-token bridge — confirmed by
  the user, accepted as a larger, phased effort (this is sub-project 2 of
  that larger effort; sub-project 3 covers products/orders, sub-project 4
  covers the Angular swap).
- Admin seeding: reuse the existing demo credentials
  (`admin@email.com` / `admin123`) rather than inventing new ones.
- Token expiry: 7 days, no refresh token — matches the app's low-stakes,
  small-scale nature.
