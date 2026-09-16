# Monorepo Restructuring + Backend Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the repo into a monorepo (`ko_front/` + `ko_back/`) and stand up an empty, working FastAPI + SQLAlchemy + PostgreSQL backend skeleton — no auth, no business endpoints yet.

**Architecture:** Move the existing Angular app into `ko_front/` via `git mv` (history preserved). Build `ko_back/` as a `uv`-managed FastAPI project: `pydantic-settings` config, a SQLAlchemy 2.0 engine/session, four ORM models (`User`, `Product`, `Order`, `OrderItem`), a hand-written initial Alembic migration, Postgres via Docker Compose, and one `/health` route to prove the app boots.

**Tech Stack:** Python 3.13, `uv`, FastAPI, SQLAlchemy 2.0, Alembic, `psycopg[binary]` (Postgres v3 driver), `pydantic-settings`, `pytest`, `httpx` (for `TestClient`), Docker Compose (Postgres 16).

**Spec:** `docs/superpowers/specs/2026-09-16-monorepo-backend-base-design.md`

## Global Constraints

- No comments in any code file. Fully type-annotated.
- Compact, no speculative abstraction — no service/repository layers yet (nothing to abstract with a single model each).
- Singular table names (`user`, `product`, `order`, `order_item`), matching the spec's FK wording (`user.id`, `order.id`).
- `docs/`, `.claude/`, `.superpowers/`, `.git/` stay at the monorepo root — never moved into `ko_front/` or `ko_back/`.
- This sub-project does not touch the Angular app's runtime behavior or its Firebase calls at all — only its location on disk moves.
- Run `ko_front` tests with (from inside `ko_front/`): `npx ng test --watch=false`.
- Run `ko_back` tests with (from inside `ko_back/`, after `uv sync`): `uv run pytest`.

---

## File Structure

| File | Responsibility |
|---|---|
| `ko_front/**` | The existing Angular app, moved as-is (git history preserved) |
| `.gitignore` (root) | Updated so Angular's ignored paths are rooted under `ko_front/` |
| `ko_back/pyproject.toml` | Python deps (uv-managed) |
| `ko_back/docker-compose.yml` | Postgres 16 service for local dev |
| `ko_back/.env.example` / `ko_back/.gitignore` | Env var template; ignores `.venv/`, `__pycache__/`, `.env` |
| `ko_back/app/core/config.py` | `Settings` (pydantic-settings) |
| `ko_back/app/core/database.py` | SQLAlchemy engine, session factory, `Base`, `get_db` |
| `ko_back/app/models/{user,product,order}.py` | ORM models |
| `ko_back/alembic/**` | Migrations (hand-written initial revision) |
| `ko_back/app/main.py` | FastAPI app + `/health` |
| `ko_back/tests/**` | `pytest` coverage for the above |

---

### Task 1: Move the Angular app into `ko_front/`

**Files:**
- Move: `.editorconfig`, `.prettierrc`, `.vscode/`, `angular.json`, `package.json`, `package-lock.json`, `public/`, `README.md`, `src/`, `tsconfig.app.json`, `tsconfig.json`, `tsconfig.spec.json` → same names under `ko_front/`
- Modify: `.gitignore` (root)

**Interfaces:** none (pure file relocation, no code changes) — produces the `ko_front/` directory that every later sub-project's frontend work happens inside.

- [ ] **Step 1: Create `ko_front/` and move every Angular-specific path into it**

```bash
mkdir ko_front
git mv .editorconfig ko_front/.editorconfig
git mv .prettierrc ko_front/.prettierrc
git mv .vscode ko_front/.vscode
git mv angular.json ko_front/angular.json
git mv package.json ko_front/package.json
git mv package-lock.json ko_front/package-lock.json
git mv public ko_front/public
git mv README.md ko_front/README.md
git mv src ko_front/src
git mv tsconfig.app.json ko_front/tsconfig.app.json
git mv tsconfig.json ko_front/tsconfig.json
git mv tsconfig.spec.json ko_front/tsconfig.spec.json
```

`docs/`, `.gitignore`, `.git/`, `.claude/`, `.superpowers/` stay exactly where they are.

- [ ] **Step 2: Update the root `.gitignore` so Angular-specific ignored paths are rooted under `ko_front/`**

Replace the full contents of `.gitignore` with:

```
# Compiled output
/ko_front/dist
/tmp
/out-tsc
/bazel-out

# Node
/ko_front/node_modules
npm-debug.log
yarn-error.log

# IDEs and editors
.idea/
.project
.classpath
.c9/
*.launch
.settings/
*.sublime-workspace

# Visual Studio Code
ko_front/.vscode/*
!ko_front/.vscode/settings.json
!ko_front/.vscode/tasks.json
!ko_front/.vscode/launch.json
!ko_front/.vscode/extensions.json
!ko_front/.vscode/mcp.json
.history/*

# Miscellaneous
/ko_front/.angular/cache
.sass-cache/
/connect.lock
/coverage
/libpeerconnection.log
testem.log
/typings
__screenshots__/

# System files
.DS_Store
Thumbs.db
```

- [ ] **Step 3: Reinstall dependencies and run the existing suite from the new location**

```bash
cd ko_front
npm install
npx ng test --watch=false
```

Expected: same result as before the move — 46 passed, 5 pre-existing unrelated failures (no new failures, no fewer passes).

- [ ] **Step 4: Confirm the app still builds from the new location**

```bash
cd ko_front
npx ng build
```

Expected: succeeds, same pre-existing warnings as before (sass deprecation, budget warnings), no new errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: move Angular app into ko_front/"
```

---

### Task 2: `ko_back` project setup — config, database, Docker Compose

**Files:**
- Create: `ko_back/pyproject.toml`
- Create: `ko_back/.gitignore`
- Create: `ko_back/.env.example`
- Create: `ko_back/docker-compose.yml`
- Create: `ko_back/app/__init__.py`
- Create: `ko_back/app/core/__init__.py`
- Create: `ko_back/app/core/config.py`
- Create: `ko_back/app/core/database.py`
- Test: `ko_back/tests/__init__.py`, `ko_back/tests/test_config.py`

**Interfaces:**
- Produces: `Settings` (`ko_back/app/core/config.py`) with `.database_url: str`, module-level `settings: Settings`; `Base` (declarative base), `engine`, `SessionLocal`, `get_db()` generator (`ko_back/app/core/database.py`) — Task 3's models import `Base` from here, Task 4's app imports `get_db`.

- [ ] **Step 1: Write `pyproject.toml`**

`ko_back/pyproject.toml`:

```toml
[project]
name = "ko-back"
version = "0.1.0"
requires-python = ">=3.13"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "sqlalchemy>=2.0",
    "alembic>=1.13",
    "psycopg[binary]>=3.2",
    "pydantic-settings>=2.6",
]

[dependency-groups]
dev = [
    "pytest>=8.3",
    "httpx>=0.27",
]

[tool.uv]
package = false
```

- [ ] **Step 2: Write `.gitignore`, `.env.example`, `docker-compose.yml`**

`ko_back/.gitignore`:

```
.venv/
__pycache__/
*.pyc
.env
```

`ko_back/.env.example`:

```
DATABASE_URL=postgresql+psycopg://ko:ko@localhost:5432/ko_patisserie
```

`ko_back/docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: ko
      POSTGRES_PASSWORD: ko
      POSTGRES_DB: ko_patisserie
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

- [ ] **Step 3: Write the failing test for `Settings`**

`ko_back/tests/__init__.py`: empty file.

`ko_back/tests/test_config.py`:

```python
from app.core.config import Settings


def test_settings_default_database_url() -> None:
    assert Settings().database_url == "postgresql+psycopg://ko:ko@localhost:5432/ko_patisserie"


def test_settings_reads_database_url_from_env(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://x:y@otherhost:5432/other")
    assert Settings().database_url == "postgresql+psycopg://x:y@otherhost:5432/other"
```

- [ ] **Step 4: Install dependencies and confirm the test fails**

```bash
cd ko_back
uv sync
uv run pytest tests/test_config.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app'` (nothing implemented yet).

- [ ] **Step 5: Implement `app/core/config.py` and `app/core/database.py`**

`ko_back/app/__init__.py`: empty file.

`ko_back/app/core/__init__.py`: empty file.

`ko_back/app/core/config.py`:

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+psycopg://ko:ko@localhost:5432/ko_patisserie"


settings = Settings()
```

`ko_back/app/core/database.py`:

```python
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 6: Run the test and confirm it passes**

```bash
cd ko_back
uv run pytest tests/test_config.py -v
```

Expected: PASS — both tests green.

- [ ] **Step 7: Confirm Postgres boots via Docker Compose**

```bash
cd ko_back
cp .env.example .env
docker compose up -d
docker compose ps
```

Expected: the `postgres` service shows as `running`/`healthy`.

- [ ] **Step 8: Commit**

```bash
git add ko_back/pyproject.toml ko_back/uv.lock ko_back/.gitignore ko_back/.env.example ko_back/docker-compose.yml ko_back/app ko_back/tests
git commit -m "feat(backend): add ko_back project skeleton (config, database, docker compose)"
```

---

### Task 3: SQLAlchemy models + initial Alembic migration

**Files:**
- Create: `ko_back/app/models/__init__.py`
- Create: `ko_back/app/models/user.py`
- Create: `ko_back/app/models/product.py`
- Create: `ko_back/app/models/order.py`
- Create: `ko_back/alembic.ini`
- Create: `ko_back/alembic/env.py`
- Create: `ko_back/alembic/script.py.mako`
- Create: `ko_back/alembic/versions/0001_initial.py`
- Test: `ko_back/tests/conftest.py`, `ko_back/tests/test_models.py`

**Interfaces:**
- Consumes: `Base` from `ko_back/app/core/database.py` (Task 2).
- Produces: `User`, `UserRole` (`app/models/user.py`); `Product`, `ProductCategory` (`app/models/product.py`); `Order`, `OrderItem`, `OrderStatus` (`app/models/order.py`) — all re-exported from `app/models/__init__.py`. Task 4 and later sub-projects import these.

- [ ] **Step 1: Write the failing test**

`ko_back/tests/conftest.py`:

```python
from collections.abc import Generator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import Base
import app.models  # noqa: F401


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
```

`ko_back/tests/test_models.py`:

```python
from app.models import Order, OrderItem, OrderStatus, Product, ProductCategory, User, UserRole


def test_create_user(db_session) -> None:
    user = User(email="ana@test.com", hashed_password="hashed", role=UserRole.CUSTOMER)
    db_session.add(user)
    db_session.commit()
    assert user.id is not None
    assert user.role == UserRole.CUSTOMER


def test_create_product(db_session) -> None:
    product = Product(
        name="Mochi de Fresa",
        price=3.5,
        description="Tierno mochi relleno de anko y fresas frescas.",
        emoji="🍓",
        category=ProductCategory.MOCHI,
    )
    db_session.add(product)
    db_session.commit()
    assert product.id is not None
    assert product.is_new is False


def test_create_order_with_items(db_session) -> None:
    user = User(email="ana@test.com", hashed_password="hashed")
    db_session.add(user)
    db_session.commit()

    order = Order(
        user_id=user.id,
        pickup_name="Ana",
        pickup_phone="600111222",
        pickup_time="Hoy 18:00",
        total=7.0,
        items=[OrderItem(product_id=1, name="Mochi de Fresa", price=3.5, quantity=2)],
    )
    db_session.add(order)
    db_session.commit()

    assert order.id is not None
    assert order.status == OrderStatus.PENDIENTE
    assert len(order.items) == 1
    assert order.items[0].order_id == order.id
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd ko_back
uv run pytest tests/test_models.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.models'`.

- [ ] **Step 3: Implement the models**

`ko_back/app/models/user.py`:

```python
import enum
from datetime import datetime

from sqlalchemy import Enum, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    CUSTOMER = "customer"


class User(Base):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.CUSTOMER)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
```

`ko_back/app/models/product.py`:

```python
import enum
from datetime import datetime

from sqlalchemy import Boolean, Enum, Float, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base


class ProductCategory(str, enum.Enum):
    MOCHI = "mochi"
    DONUT = "donut"
    CAKE = "cake"
    DRINK = "drink"


class Product(Base):
    __tablename__ = "product"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)
    price: Mapped[float] = mapped_column(Float)
    description: Mapped[str] = mapped_column(String)
    emoji: Mapped[str] = mapped_column(String)
    category: Mapped[ProductCategory] = mapped_column(Enum(ProductCategory))
    is_new: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
```

`ko_back/app/models/order.py`:

```python
import enum
from datetime import datetime

from sqlalchemy import Enum, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base


class OrderStatus(str, enum.Enum):
    PENDIENTE = "pendiente"
    LISTO = "listo"
    ENTREGADO = "entregado"


class Order(Base):
    __tablename__ = "order"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"))
    pickup_name: Mapped[str] = mapped_column(String)
    pickup_phone: Mapped[str] = mapped_column(String)
    pickup_time: Mapped[str] = mapped_column(String)
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus), default=OrderStatus.PENDIENTE)
    total: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    items: Mapped[list["OrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan")


class OrderItem(Base):
    __tablename__ = "order_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("order.id"))
    product_id: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String)
    price: Mapped[float] = mapped_column(Float)
    quantity: Mapped[int] = mapped_column(Integer)

    order: Mapped["Order"] = relationship(back_populates="items")
```

`ko_back/app/models/__init__.py`:

```python
from app.models.order import Order, OrderItem, OrderStatus
from app.models.product import Product, ProductCategory
from app.models.user import User, UserRole

__all__ = [
    "Order",
    "OrderItem",
    "OrderStatus",
    "Product",
    "ProductCategory",
    "User",
    "UserRole",
]
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd ko_back
uv run pytest tests/test_models.py -v
```

Expected: PASS — all 3 tests green.

- [ ] **Step 5: Set up Alembic and write the initial migration by hand**

`ko_back/alembic.ini`:

```ini
[alembic]
script_location = alembic

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console
qualname =

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

`ko_back/alembic/env.py`:

```python
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

import app.models  # noqa: F401
from app.core.config import settings
from app.core.database import Base

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

`ko_back/alembic/script.py.mako`:

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision: str = ${repr(up_revision)}
down_revision: Union[str, None] = ${repr(down_revision)}
branch_labels: Union[str, Sequence[str], None] = ${repr(branch_labels)}
depends_on: Union[str, Sequence[str], None] = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

`ko_back/alembic/versions/0001_initial.py`:

```python
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(), nullable=False, unique=True),
        sa.Column("hashed_password", sa.String(), nullable=False),
        sa.Column(
            "role",
            sa.Enum("admin", "customer", name="userrole"),
            nullable=False,
            server_default="customer",
        ),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index("ix_user_email", "user", ["email"])

    op.create_table(
        "product",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("emoji", sa.String(), nullable=False),
        sa.Column(
            "category",
            sa.Enum("mochi", "donut", "cake", "drink", name="productcategory"),
            nullable=False,
        ),
        sa.Column("is_new", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )

    op.create_table(
        "order",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("pickup_name", sa.String(), nullable=False),
        sa.Column("pickup_phone", sa.String(), nullable=False),
        sa.Column("pickup_time", sa.String(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pendiente", "listo", "entregado", name="orderstatus"),
            nullable=False,
            server_default="pendiente",
        ),
        sa.Column("total", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )

    op.create_table(
        "order_item",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("order.id"), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("order_item")
    op.drop_table("order")
    op.drop_table("product")
    op.drop_table("user")
    sa.Enum(name="orderstatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="productcategory").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="userrole").drop(op.get_bind(), checkfirst=True)
```

- [ ] **Step 6: Run the migration against the dockerized Postgres**

```bash
cd ko_back
docker compose up -d
uv run alembic upgrade head
```

Expected: no errors; four tables (`user`, `product`, `order`, `order_item`) exist in the `ko_patisserie` database.

- [ ] **Step 7: Commit**

```bash
git add ko_back/app/models ko_back/alembic.ini ko_back/alembic ko_back/tests
git commit -m "feat(backend): add SQLAlchemy models and initial migration"
```

---

### Task 4: FastAPI app entrypoint + health check

**Files:**
- Create: `ko_back/app/main.py`
- Create: `ko_back/tests/test_main.py`

**Interfaces:**
- Consumes: nothing new (this task is intentionally self-contained — no auth, no DB access from the route itself).
- Produces: `app` (FastAPI instance, `ko_back/app/main.py`) — `uvicorn app.main:app` is the run command every later sub-project builds on.

- [ ] **Step 1: Write the failing test**

`ko_back/tests/test_main.py`:

```python
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd ko_back
uv run pytest tests/test_main.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.main'`.

- [ ] **Step 3: Implement `app/main.py`**

```python
from fastapi import FastAPI

app = FastAPI(title="Ko Pâtisserie API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd ko_back
uv run pytest tests/test_main.py -v
```

Expected: PASS.

- [ ] **Step 5: Run the full `ko_back` suite once**

```bash
cd ko_back
uv run pytest -v
```

Expected: PASS — every test from Tasks 2, 3, and 4 green (7 tests total: 2 config + 3 models + 1 health, plus any collection-only files).

- [ ] **Step 6: Manual boot check**

```bash
cd ko_back
uv run uvicorn app.main:app --reload
curl http://localhost:8000/health
```

Expected: `{"status":"ok"}`.

- [ ] **Step 7: Commit**

```bash
git add ko_back/app/main.py ko_back/tests/test_main.py
git commit -m "feat(backend): add FastAPI app entrypoint with health check"
```

---

### Task 5: Final verification

**Files:** none (no code changes — this task only verifies Tasks 1–4 work together).

- [ ] **Step 1: Run both suites one last time**

```bash
cd ko_front && npx ng test --watch=false
cd ko_back && uv run pytest -v
```

Expected: `ko_front` — 46 passed, 5 pre-existing unrelated failures (unchanged from before this branch). `ko_back` — all tests passing.

- [ ] **Step 2: Confirm both apps boot side by side**

```bash
cd ko_back && docker compose up -d && uv run alembic upgrade head && uv run uvicorn app.main:app --reload &
cd ko_front && npx ng serve
```

Expected: `http://localhost:8000/health` returns `{"status":"ok"}`; `http://localhost:4200` serves the Angular app exactly as before (still talking to Firebase — untouched by this sub-project).

- [ ] **Step 3: Report results**

If both suites are green and both apps boot, this sub-project is done — no further commit needed for this task. If anything fails, fix it in the task that owns the broken piece and re-run that task's test cycle.
