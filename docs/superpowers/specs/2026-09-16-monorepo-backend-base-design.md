# Monorepo Restructuring + Backend Base — Design

## Context

The project is moving from a Firebase/Firestore-only backend to a custom
backend: Python, FastAPI, SQLAlchemy, PostgreSQL, with two separate user
roles (`admin`/`customer`) and two separate login entry points. This is a
multi-subsystem effort, split into sub-projects, each with its own
spec/plan/branch. This is **sub-project 1**: restructure the repo into a
monorepo and stand up an empty, working backend skeleton — no auth, no
business endpoints yet (those are sub-projects 2 and 3). The existing
Angular app keeps talking to Firebase for now; nothing about its runtime
behavior changes in this sub-project.

## Goals

- Repo root renamed `sakura_project` → `ko_patisserie`.
- Existing Angular app moved into `ko_front/`, history preserved via `git mv`.
- New `ko_back/`: FastAPI project (uv-managed), SQLAlchemy 2.0 models for
  `User`, `Product`, `Order`, `OrderItem`, Alembic migrations, Postgres via
  Docker Compose.
- `alembic upgrade head` creates the (empty) tables; `uvicorn app.main:app`
  serves a FastAPI app with no real routes yet (health check only).
- Cross-cutting project files (`docs/`, `.claude/`, `.superpowers/`, `.git/`)
  stay at the monorepo root — they aren't Angular- or backend-specific.

## Non-goals

- Auth endpoints, password hashing, JWT issuance — sub-project 2.
- Product/Order CRUD endpoints — sub-project 3.
- Any change to the Angular app's runtime behavior or its Firebase calls —
  sub-project 4 swaps those out, not this one.
- Data migration from Firestore into Postgres — out of scope entirely; the
  new backend starts from an empty database.
- Production deployment / CI changes for the new backend.

## Repo layout after this sub-project

```
ko_patisserie/
  .git/
  .claude/
  .superpowers/
  docs/
    superpowers/{specs,plans}/
  ko_front/
    src/, public/, angular.json, package.json, package-lock.json,
    tsconfig*.json, .angular/, .editorconfig, .prettierrc, README.md
  ko_back/
    pyproject.toml
    uv.lock
    .env.example
    .gitignore
    docker-compose.yml
    alembic.ini
    alembic/
      env.py
      versions/
    app/
      __init__.py
      main.py
      core/
        __init__.py
        config.py
        database.py
      models/
        __init__.py
        user.py
        product.py
        order.py
```

`ko_front/dist/` and `ko_front/node_modules/` keep being gitignored (paths
in the root `.gitignore` move from `/dist`, `/node_modules` to
`/ko_front/dist`, `/ko_front/node_modules`). A new `ko_back/.gitignore`
(or root-level entries) covers `.venv/`, `__pycache__/`, `ko_back/.env`.

## Architecture — `ko_back`

**Dependency management:** `uv`. `pyproject.toml` pins Python 3.13,
FastAPI, SQLAlchemy 2.0, `psycopg[binary]` (Postgres driver v3),
`pydantic-settings`, `alembic`.

**`app/core/config.py`:** a `pydantic-settings` `Settings` class reading
`DATABASE_URL` (and later `SECRET_KEY` etc.) from environment / `.env`.

**`app/core/database.py`:** SQLAlchemy 2.0 sync engine + `sessionmaker`,
a `Base` declarative class, and a `get_db` FastAPI dependency (yields a
session, closes it after the request).

**Models** (`app/models/`), SQLAlchemy 2.0 style (`Mapped`/`mapped_column`):

- `User` (`user.py`): `id: int` (PK), `email: str` (unique, indexed),
  `hashed_password: str`, `role: Enum('admin', 'customer')`,
  `created_at: datetime` (server default `now()`).
- `Product` (`product.py`): `id: int` (PK), `name: str`, `price: float`,
  `description: str`, `emoji: str`,
  `category: Enum('mochi', 'donut', 'cake', 'drink')`,
  `is_new: bool` (default `False`), `created_at: datetime`.
- `Order` (`order.py`): `id: int` (PK), `user_id: int` (FK → `user.id`),
  `pickup_name: str`, `pickup_phone: str`, `pickup_time: str`,
  `status: Enum('pendiente', 'listo', 'entregado')` (default `'pendiente'`),
  `total: float`, `created_at: datetime`.
- `OrderItem` (`order.py`, same file as `Order`): `id: int` (PK),
  `order_id: int` (FK → `order.id`), `product_id: int`, `name: str`,
  `price: float`, `quantity: int`. Snapshot fields (`name`/`price` copied
  at purchase time), matching the pattern already used for `Order.items`
  in the Firestore version — editing a `Product` later must not change
  historical orders.

`Order.items` is a SQLAlchemy `relationship()` to `OrderItem`
(`cascade="all, delete-orphan"`).

**`app/main.py`:** FastAPI app instance, one `GET /health` route
returning `{"status": "ok"}`. No routers, no auth — proves the app boots
and can reach the DB in later sub-projects without carrying scope here.

**Migrations:** Alembic configured against `app.core.database.Base` /
`app.core.config.Settings.database_url`; one generated initial migration
creating all four tables. `alembic upgrade head` is the acceptance check
for this sub-project.

**`docker-compose.yml`:** single `postgres:16` service, named volume,
port `5432` mapped, credentials/db name from `.env` (matching
`DATABASE_URL` in `.env.example`).

## Testing

- `ko_back`: a `tests/` directory with `pytest` is reasonable scaffolding
  to include even though there's no business logic yet — one test that
  imports `app.main.app` and asserts `GET /health` returns 200 via
  `TestClient`, plus one test that creates a `User`/`Product`/`Order` row
  against a throwaway SQLite in-memory engine (or a test Postgres via the
  same compose file) and reads it back, to pin the model definitions.
- `ko_front`: no behavior changed, so its existing Vitest suite is the
  regression check — same pass/fail counts as today, just running from
  `ko_front/` instead of the repo root.
- Manual acceptance: `docker compose up -d` (in `ko_back/`), `alembic
  upgrade head`, `uv run uvicorn app.main:app --reload`, `curl
  localhost:8000/health` → `{"status":"ok"}`.

## Branch / workflow

- Integration branch is `dev` (already fast-forwarded to current `main`).
- This sub-project is built on `chore/monorepo-setup`, branched from `dev`,
  merged back into `dev` when done. `main` is only updated from `dev` as a
  deliberate, later step — not part of this sub-project.

## Code style

No comments. Fully type-annotated. Compact — no speculative abstraction
(no service/repository layers yet; those earn their place once
sub-project 3 adds real endpoints with actual duplicated logic to
justify them).

## Open items resolved during brainstorming

- Postgres: Docker Compose (not a pre-existing local install).
- Python tooling: `uv`.
- Branching: everything for this sub-project on one branch
  (`chore/monorepo-setup`), off `dev`.
- Order items: a real `order_items` table, not a JSON column.
- `docs/`, `.claude/`, `.superpowers/` stay at the monorepo root.
