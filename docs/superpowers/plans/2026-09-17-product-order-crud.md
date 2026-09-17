# Product/Order CRUD (ko_back) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `ko_back` the business API — full CRUD for `Product` and order creation/listing/status-updates for `Order` — built on sub-project 2's auth, so sub-project 4 (Angular swapping Firebase for this API) has real endpoints to call.

**Architecture:** Two new FastAPI routers (`/products`, `/orders`) added to the existing app. Product writes and order status updates are gated by a new `require_admin` dependency built on the existing `get_current_user`. Order creation trusts only `product_id`/`quantity` from the client — the server looks up each `Product`, snapshots its current `name`/`price`, and computes `total` itself, closing a price-tampering path the current Firestore version doesn't close.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2.0, `pytest` + `httpx` (`TestClient`), `uv`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-17-product-order-crud-design.md`

## Global Constraints

- `GET /products` requires no authentication.
- `POST /products`, `PUT /products/{id}`, `DELETE /products/{id}` require admin (`require_admin`).
- `POST /orders`, `GET /orders`, `GET /orders/{id}` require any authenticated user (`get_current_user`); `PATCH /orders/{id}/status` requires admin.
- `POST /orders` request body carries only `product_id`+`quantity` per item — never `price`, `name`, or `total`, and never `user_id`. The server computes/derives all of those; `user_id` comes from the authenticated caller.
- `GET /orders`: one endpoint. Admin role sees all orders; any other role sees only orders where `user_id` matches the caller.
- `GET /orders/{id}`: returns 404 (never 403) when the caller is neither the order's owner nor an admin — an authorization failure must never double as an existence oracle.
- `require_admin` reads `current_user.role` as loaded fresh from the DB by `get_current_user` — never from the JWT's `role` claim directly.
- All JSON field names are snake_case, matching the SQLAlchemy column names exactly. No camelCase, no field aliasing.
- No comments in code. Fully type-annotated. No service/repository layer.
- Route paths with no trailing path segment are declared as `@router.get("")` / `@router.post("")`, never `"/"` — with an `APIRouter(prefix=...)`, a `"/"` route creates a trailing-slash redirect from the un-slashed URL, which is not what any client here expects.
- All commands below run from inside `ko_back/`.

## Execution Workflow

Same per-task-branch pattern as the backend-auth plan: each task gets its
own branch off the current tip of `dev` (`feat/product-order-crud-<slug>`),
merged into `dev` as soon as that task's review is clean, branch deleted,
next task branches from the updated `dev`. The final review compares
`dev` before this plan started against `dev`'s tip after the last task
merges, instead of reviewing one long-lived feature branch.

---

### Task 1: `require_admin` dependency

**Files:**
- Modify: `ko_back/app/core/deps.py`
- Test: `ko_back/tests/test_deps.py`

**Interfaces:**
- Consumes: `app.core.deps.get_current_user` (existing), `app.models.user.User`, `app.models.user.UserRole` (existing).
- Produces: `require_admin(current_user: User = Depends(get_current_user)) -> User` (raises `HTTPException(403)` if `current_user.role != UserRole.ADMIN`) — consumed by Task 2 (product writes) and Task 5 (order status update).

- [ ] **Step 1: Write the failing tests**

Create `ko_back/tests/test_deps.py`:

```python
import pytest
from fastapi import HTTPException

from app.core.deps import require_admin
from app.models.user import User, UserRole


def test_require_admin_allows_admin() -> None:
    admin = User(id=1, email="admin@test.com", role=UserRole.ADMIN)
    assert require_admin(current_user=admin) is admin


def test_require_admin_rejects_customer() -> None:
    customer = User(id=2, email="cliente@test.com", role=UserRole.CUSTOMER)
    with pytest.raises(HTTPException) as exc_info:
        require_admin(current_user=customer)
    assert exc_info.value.status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_deps.py -v`
Expected: FAIL — `ImportError: cannot import name 'require_admin' from 'app.core.deps'`

- [ ] **Step 3: Add the dependency**

In `ko_back/app/core/deps.py`, change the import line:

```python
from app.models.user import User
```
to:
```python
from app.models.user import User, UserRole
```

Then append at the end of the file:

```python
def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Se requiere rol de administrador")
    return current_user
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_deps.py -v`
Expected: PASS (2 tests)

Run: `uv run pytest -v`
Expected: PASS (all tests, no regressions)

- [ ] **Step 5: Commit**

```bash
git add app/core/deps.py tests/test_deps.py
git commit -m "feat(backend): add require_admin dependency"
```

---

### Task 2: Product CRUD

**Files:**
- Create: `ko_back/app/schemas/product.py`
- Create: `ko_back/app/api/products.py`
- Modify: `ko_back/app/main.py`
- Modify: `ko_back/tests/conftest.py`
- Create: `ko_back/tests/test_products.py`

**Interfaces:**
- Consumes: `require_admin` (Task 1), `app.core.database.get_db`, `app.models.product.Product`, `app.models.product.ProductCategory`.
- Produces: `ProductWrite {name: str, price: float, description: str, emoji: str, category: ProductCategory, is_new: bool = False}`, `ProductResponse {id, name, price, description, emoji, category, is_new, created_at}`, mounted router `products_router` with `GET /products`, `POST /products`, `PUT /products/{id}`, `DELETE /products/{id}`. `admin_token`/`customer_token` pytest fixtures in `conftest.py` — consumed by Task 3, 4, 5's tests too.

- [ ] **Step 1: Write the failing tests**

Create `ko_back/tests/test_products.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_products.py -v`
Expected: FAIL — `fixture 'admin_token' not found` (and `404 Not Found` for `/products` once fixtures resolve, since the route doesn't exist yet)

- [ ] **Step 3: Add the `admin_token`/`customer_token` fixtures**

In `ko_back/tests/conftest.py`, add this import alongside the existing ones at the top:

```python
from app.scripts.seed_admin import ADMIN_EMAIL, ADMIN_PASSWORD, seed_admin
```

Then append at the end of the file:

```python
@pytest.fixture
def admin_token(client: TestClient, db_session: Session) -> str:
    seed_admin(db_session)
    response = client.post("/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    return response.json()["access_token"]


@pytest.fixture
def customer_token(client: TestClient) -> str:
    response = client.post("/auth/register", json={"email": "cliente@test.com", "password": "secret123"})
    return response.json()["access_token"]
```

- [ ] **Step 4: Write the schemas**

Create `ko_back/app/schemas/product.py`:

```python
from datetime import datetime

from pydantic import BaseModel

from app.models.product import ProductCategory


class ProductWrite(BaseModel):
    name: str
    price: float
    description: str
    emoji: str
    category: ProductCategory
    is_new: bool = False


class ProductResponse(BaseModel):
    id: int
    name: str
    price: float
    description: str
    emoji: str
    category: ProductCategory
    is_new: bool
    created_at: datetime
```

- [ ] **Step 5: Write the router**

Create `ko_back/app/api/products.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_admin
from app.models.product import Product
from app.models.user import User
from app.schemas.product import ProductResponse, ProductWrite

router = APIRouter(prefix="/products", tags=["products"])


def _to_response(product: Product) -> ProductResponse:
    return ProductResponse(
        id=product.id,
        name=product.name,
        price=product.price,
        description=product.description,
        emoji=product.emoji,
        category=product.category,
        is_new=product.is_new,
        created_at=product.created_at,
    )


@router.get("", response_model=list[ProductResponse])
def list_products(db: Session = Depends(get_db)) -> list[ProductResponse]:
    return [_to_response(p) for p in db.query(Product).all()]


@router.post("", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
def create_product(
    body: ProductWrite, db: Session = Depends(get_db), _admin: User = Depends(require_admin)
) -> ProductResponse:
    product = Product(**body.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)
    return _to_response(product)


@router.put("/{product_id}", response_model=ProductResponse)
def update_product(
    product_id: int,
    body: ProductWrite,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ProductResponse:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Producto no encontrado")
    for field, value in body.model_dump().items():
        setattr(product, field, value)
    db.commit()
    db.refresh(product)
    return _to_response(product)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(
    product_id: int, db: Session = Depends(get_db), _admin: User = Depends(require_admin)
) -> None:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Producto no encontrado")
    db.delete(product)
    db.commit()
```

- [ ] **Step 6: Mount the router in `main.py`**

Replace the full contents of `ko_back/app/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.products import router as products_router

app = FastAPI(title="Ko Pâtisserie API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(products_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `uv run pytest tests/test_products.py -v`
Expected: PASS (11 tests)

Run: `uv run pytest -v`
Expected: PASS (all tests, no regressions)

- [ ] **Step 8: Commit**

```bash
git add app/schemas/product.py app/api/products.py app/main.py tests/conftest.py tests/test_products.py
git commit -m "feat(backend): add product CRUD endpoints"
```

---

### Task 3: Order creation

**Files:**
- Create: `ko_back/app/schemas/order.py`
- Create: `ko_back/app/api/orders.py`
- Modify: `ko_back/app/main.py`
- Create: `ko_back/tests/test_orders.py`

**Interfaces:**
- Consumes: `get_current_user` (existing), `admin_token`/`customer_token` fixtures (Task 2), `app.models.product.Product`, `app.models.order.Order`, `app.models.order.OrderItem`.
- Produces: `OrderItemCreate {product_id: int, quantity: int}`, `OrderCreate {items: list[OrderItemCreate], pickup_name, pickup_phone, pickup_time}`, `OrderItemResponse {product_id, name, price, quantity}`, `OrderResponse {id, user_id, items, total, pickup_name, pickup_phone, pickup_time, status, created_at}`, mounted router `orders_router` with `POST /orders` only — Task 4 adds `GET /orders` and `GET /orders/{id}` to the same router file, Task 5 adds `PATCH /orders/{id}/status`.

- [ ] **Step 1: Write the failing tests**

Create `ko_back/tests/test_orders.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_orders.py -v`
Expected: FAIL — `404 Not Found` (route doesn't exist yet) / collection errors once schemas are imported

- [ ] **Step 3: Write the schemas**

Create `ko_back/app/schemas/order.py`:

```python
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.order import OrderStatus


class OrderItemCreate(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)


class OrderCreate(BaseModel):
    items: list[OrderItemCreate] = Field(min_length=1)
    pickup_name: str
    pickup_phone: str
    pickup_time: str


class OrderItemResponse(BaseModel):
    product_id: int
    name: str
    price: float
    quantity: int


class OrderResponse(BaseModel):
    id: int
    user_id: int
    items: list[OrderItemResponse]
    total: float
    pickup_name: str
    pickup_phone: str
    pickup_time: str
    status: OrderStatus
    created_at: datetime


class OrderStatusUpdate(BaseModel):
    status: OrderStatus
```

- [ ] **Step 4: Write the router**

Create `ko_back/app/api/orders.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.order import Order, OrderItem
from app.models.product import Product
from app.models.user import User
from app.schemas.order import OrderCreate, OrderItemResponse, OrderResponse

router = APIRouter(prefix="/orders", tags=["orders"])


def _to_response(order: Order) -> OrderResponse:
    return OrderResponse(
        id=order.id,
        user_id=order.user_id,
        items=[
            OrderItemResponse(product_id=i.product_id, name=i.name, price=i.price, quantity=i.quantity)
            for i in order.items
        ],
        total=order.total,
        pickup_name=order.pickup_name,
        pickup_phone=order.pickup_phone,
        pickup_time=order.pickup_time,
        status=order.status,
        created_at=order.created_at,
    )


@router.post("", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
def create_order(
    body: OrderCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> OrderResponse:
    items: list[OrderItem] = []
    for line in body.items:
        product = db.get(Product, line.product_id)
        if product is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Producto {line.product_id} no encontrado",
            )
        items.append(
            OrderItem(product_id=product.id, name=product.name, price=product.price, quantity=line.quantity)
        )
    total = sum(item.price * item.quantity for item in items)
    order = Order(
        user_id=current_user.id,
        items=items,
        total=total,
        pickup_name=body.pickup_name,
        pickup_phone=body.pickup_phone,
        pickup_time=body.pickup_time,
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return _to_response(order)
```

- [ ] **Step 5: Mount the router in `main.py`**

Replace the full contents of `ko_back/app/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.orders import router as orders_router
from app.api.products import router as products_router

app = FastAPI(title="Ko Pâtisserie API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(products_router)
app.include_router(orders_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/test_orders.py -v`
Expected: PASS (6 tests)

Run: `uv run pytest -v`
Expected: PASS (all tests, no regressions)

- [ ] **Step 7: Commit**

```bash
git add app/schemas/order.py app/api/orders.py app/main.py tests/test_orders.py
git commit -m "feat(backend): add order creation endpoint"
```

---

### Task 4: Order listing (role-filtered) + get by id

**Files:**
- Modify: `ko_back/app/api/orders.py`
- Modify: `ko_back/tests/test_orders.py`

**Interfaces:**
- Consumes: everything from Task 3 (`Order`, `_to_response`, `get_current_user`, `router`).
- Produces: `GET /orders`, `GET /orders/{id}` added to the same router — consumed by Task 5's tests (not its routes).

- [ ] **Step 1: Write the failing tests**

Append to `ko_back/tests/test_orders.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_orders.py -v`
Expected: FAIL — 6 new tests error with 404 (routes don't exist yet)

- [ ] **Step 3: Add the routes**

In `ko_back/app/api/orders.py`, change the import line:

```python
from app.models.user import User
```
to:
```python
from app.models.user import User, UserRole
```

Then append at the end of the file:

```python
@router.get("", response_model=list[OrderResponse])
def list_orders(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> list[OrderResponse]:
    query = db.query(Order).order_by(Order.created_at.desc())
    if current_user.role != UserRole.ADMIN:
        query = query.filter(Order.user_id == current_user.id)
    return [_to_response(o) for o in query.all()]


@router.get("/{order_id}", response_model=OrderResponse)
def get_order(
    order_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> OrderResponse:
    order = db.get(Order, order_id)
    if order is None or (order.user_id != current_user.id and current_user.role != UserRole.ADMIN):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido no encontrado")
    return _to_response(order)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_orders.py -v`
Expected: PASS (12 tests)

Run: `uv run pytest -v`
Expected: PASS (all tests, no regressions)

- [ ] **Step 5: Commit**

```bash
git add app/api/orders.py tests/test_orders.py
git commit -m "feat(backend): add role-filtered order listing and get-by-id"
```

---

### Task 5: Order status update

**Files:**
- Modify: `ko_back/app/api/orders.py`
- Modify: `ko_back/tests/test_orders.py`

**Interfaces:**
- Consumes: `require_admin` (Task 1), everything from Tasks 3-4 (`Order`, `_to_response`, `router`).
- Produces: `PATCH /orders/{id}/status` added to the same router.

- [ ] **Step 1: Write the failing tests**

Append to `ko_back/tests/test_orders.py`:

```python
def test_update_order_status_as_admin_returns_200(client, admin_token, customer_token, db_session) -> None:
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
    response = client.patch(
        f"/orders/{order_id}/status", json={"status": "listo"}, headers=_auth_header(admin_token)
    )
    assert response.status_code == 200
    assert response.json()["status"] == "listo"


def test_update_order_status_as_customer_returns_403(client, customer_token, db_session) -> None:
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
    response = client.patch(
        f"/orders/{order_id}/status", json={"status": "listo"}, headers=_auth_header(customer_token)
    )
    assert response.status_code == 403


def test_update_order_status_missing_id_returns_404(client, admin_token) -> None:
    response = client.patch("/orders/999/status", json={"status": "listo"}, headers=_auth_header(admin_token))
    assert response.status_code == 404


def test_update_order_status_with_invalid_value_returns_422(
    client, admin_token, customer_token, db_session
) -> None:
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
    response = client.patch(
        f"/orders/{order_id}/status", json={"status": "invalido"}, headers=_auth_header(admin_token)
    )
    assert response.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_orders.py -v`
Expected: FAIL — 4 new tests error with 404/405 (route doesn't exist yet)

- [ ] **Step 3: Add the route**

In `ko_back/app/api/orders.py`, change the import lines:

```python
from app.core.deps import get_current_user
```
to:
```python
from app.core.deps import get_current_user, require_admin
```

and:

```python
from app.schemas.order import OrderCreate, OrderItemResponse, OrderResponse
```
to:
```python
from app.schemas.order import OrderCreate, OrderItemResponse, OrderResponse, OrderStatusUpdate
```

Then append at the end of the file:

```python
@router.patch("/{order_id}/status", response_model=OrderResponse)
def update_order_status(
    order_id: int,
    body: OrderStatusUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> OrderResponse:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido no encontrado")
    order.status = body.status
    db.commit()
    db.refresh(order)
    return _to_response(order)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_orders.py -v`
Expected: PASS (16 tests)

Run: `uv run pytest -v`
Expected: PASS (all tests, no regressions)

- [ ] **Step 5: Commit**

```bash
git add app/api/orders.py tests/test_orders.py
git commit -m "feat(backend): add admin order status update endpoint"
```

---

### Task 6: Manual acceptance run

**Files:** none (verification only, no commit)

- [ ] **Step 1: Start Postgres and the API**

Run: `docker compose up -d`
Run (background): `uv run uvicorn app.main:app --reload`
Expected: `Application startup complete`, listening on `http://127.0.0.1:8000`

- [ ] **Step 2: Seed the admin and log in**

```bash
uv run python -m app.scripts.seed_admin
ADMIN_TOKEN=$(curl -s -X POST http://127.0.0.1:8000/auth/login -H "Content-Type: application/json" -d '{"email":"admin@email.com","password":"admin123"}' | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
```

- [ ] **Step 3: Create a product as admin**

```bash
curl -s -X POST http://127.0.0.1:8000/products -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"name":"Mochi de Fresa","price":3.5,"description":"Mochi relleno de fresa","emoji":"🍓","category":"mochi"}'
```
Expected: `201`, body includes `"id":1` (or similar), `"is_new":false`.

- [ ] **Step 4: Register a customer and create an order**

```bash
CUSTOMER_TOKEN=$(curl -s -X POST http://127.0.0.1:8000/auth/register -H "Content-Type: application/json" -d '{"email":"cliente@test.com","password":"secret123"}' | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
curl -s -X POST http://127.0.0.1:8000/orders -H "Content-Type: application/json" -H "Authorization: Bearer $CUSTOMER_TOKEN" -d '{"items":[{"product_id":1,"quantity":2}],"pickup_name":"Ana","pickup_phone":"600111222","pickup_time":"Hoy 18:00"}'
```
Expected: `201`, `"total":7.0`, `"user_id"` matching the customer, `"status":"pendiente"`.

- [ ] **Step 5: List orders as admin, get by id, update status**

```bash
curl -s http://127.0.0.1:8000/orders -H "Authorization: Bearer $ADMIN_TOKEN"
curl -s http://127.0.0.1:8000/orders/1 -H "Authorization: Bearer $ADMIN_TOKEN"
curl -s -X PATCH http://127.0.0.1:8000/orders/1/status -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"status":"listo"}'
```
Expected: list shows the one order; get-by-id returns it; status update returns `"status":"listo"`.

- [ ] **Step 6: Confirm a customer can't see another customer's order, and can't write products**

```bash
OTHER_TOKEN=$(curl -s -X POST http://127.0.0.1:8000/auth/register -H "Content-Type: application/json" -d '{"email":"otro@test.com","password":"secret123"}' | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/orders/1 -H "Authorization: Bearer $OTHER_TOKEN"
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8000/products -H "Content-Type: application/json" -H "Authorization: Bearer $CUSTOMER_TOKEN" -d '{"name":"X","price":1,"description":"d","emoji":"x","category":"mochi"}'
```
Expected: the second customer's `GET /orders/1` (an order that isn't theirs) → `404`; the first customer's `POST /products` → `403`.

- [ ] **Step 7: Stop the test server**

Kill the backgrounded `uvicorn` process.

---

## Self-Review Notes

- Spec coverage: `GET/POST/PUT/DELETE /products` ✅ (Task 2), `POST /orders` with server-computed pricing ✅ (Task 3), role-filtered `GET /orders` + owner/admin-gated `GET /orders/{id}` with 404-not-403 ✅ (Task 4), `PATCH /orders/{id}/status` admin-only ✅ (Task 5), `require_admin` on DB-loaded role ✅ (Task 1), snake_case fields throughout ✅ (all schemas), manual acceptance ✅ (Task 6). Non-goals (frontend changes, data migration, bulk seed endpoint, partial product PATCH, soft-delete, pagination) correctly have no task.
- Type/name consistency checked: `_to_response(product: Product) -> ProductResponse` (Task 2) and `_to_response(order: Order) -> OrderResponse` (Task 3) are distinct functions in distinct files (`products.py` vs `orders.py`), no collision. `require_admin` (Task 1) signature matches its use as `Depends(require_admin)` in Task 2 (products) and Task 5 (order status). `OrderCreate`/`OrderItemCreate` (Task 3) field names match what `create_order` reads (`body.items`, `line.product_id`, `line.quantity`, `body.pickup_name/phone/time`). `admin_token`/`customer_token` fixtures (Task 2) are consumed with identical names by Tasks 3-5's tests. The two `orders.py` import-line replacements in Tasks 4 and 5 target exactly the line Task 3 wrote, verified against Task 3's exact code block.
