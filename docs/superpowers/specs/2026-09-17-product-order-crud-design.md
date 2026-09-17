# Product/Order CRUD (ko_back) — Design

## Context

Continuation of the Firebase → custom backend migration. Sub-project 1
stood up the empty `ko_back` skeleton and models
([2026-09-16-monorepo-backend-base-design.md](2026-09-16-monorepo-backend-base-design.md)).
Sub-project 2 added real authentication — register/login/JWT, roles, and
a reusable `get_current_user` dependency
([2026-09-17-backend-auth-design.md](2026-09-17-backend-auth-design.md)).
This is **sub-project 3**: the business API — CRUD for `Product`, and
order creation/listing/status updates for `Order` — built on top of
sub-project 2's auth. The Angular app keeps talking to Firestore for
products and orders until sub-project 4 swaps it over; nothing here
changes frontend runtime behavior.

## Goals

- `GET /products` — public (no auth), lists all products.
- `POST /products` — admin only, creates a product.
- `PUT /products/{id}` — admin only, full-replace update. 404 if missing.
- `DELETE /products/{id}` — admin only. 404 if missing.
- `POST /orders` — any authenticated user. Request carries only
  `product_id` + `quantity` per line item; the server looks up each
  `Product`, snapshots its *current* `name`/`price` into the `OrderItem`,
  computes `total` itself, and sets `user_id` from the JWT-derived
  current user — never from the request body. 404 if any `product_id`
  doesn't exist.
- `GET /orders` — authenticated. Admin sees all orders (newest first);
  a customer sees only their own (newest first). One endpoint, filtered
  by the caller's role — not two separate routes.
- `GET /orders/{id}` — authenticated. Returns the order only if the
  caller is its owner or an admin; otherwise **404**, not 403 — matches
  sub-project 2's precedent of never letting an authorization failure
  double as an existence oracle.
- `PATCH /orders/{id}/status` — admin only, updates `status`. 404 if
  missing, 422 if the status value is invalid.
- `require_admin` dependency in `app/core/deps.py`, built on
  `get_current_user` (role read fresh from the DB on every request, not
  from the JWT's `role` claim) — per sub-project 2's final review
  recommendation.
- All JSON field names snake_case (`is_new`, `pickup_name`, etc.),
  matching the existing SQLAlchemy column names. No camelCase aliasing.

## Non-goals

- Any Angular/frontend change — sub-project 4.
- Firestore → Postgres data migration — out of scope entirely, same as
  sub-project 1.
- A bulk "seed sample products" endpoint — that was a Firestore-era
  bootstrapping convenience (`ProductService.seedIfEmpty`), not needed
  against Postgres; products can be created one at a time via `POST
  /products` once an admin is logged in.
- Partial (`PATCH`) product updates — the frontend admin form always
  submits the full product shape (`Omit<Product, 'id'>`), so `PUT` with
  full replacement matches the actual caller; no separate `PATCH
  /products/{id}` for partial field updates.
- Soft-delete / order cancellation — `DELETE` on products is a hard
  delete (orders keep their own name/price snapshot regardless, per the
  existing `OrderItem` design — see Architecture); there's no delete or
  cancel operation on orders at all, matching the current Firestore app
  (only status transitions exist).
- Pagination — product and order lists are small enough for this app's
  scale to return in full; add it later if it becomes a real problem.

## Architecture

**`app/schemas/product.py`** (new): `ProductWrite` (`name: str`,
`price: float`, `description: str`, `emoji: str`, `category:
ProductCategory`, `is_new: bool = False`) used as the body for both
`POST` and `PUT` (the frontend always sends the full shape either way).
`ProductResponse` (`id: int`, plus all `ProductWrite` fields, plus
`created_at: datetime`).

**`app/schemas/order.py`** (new): `OrderItemCreate` (`product_id: int`,
`quantity: int = Field(gt=0)`), `OrderCreate` (`items:
list[OrderItemCreate]` with at least one item, `pickup_name: str`,
`pickup_phone: str`, `pickup_time: str`) — no `price`, `name`, or `total`
field anywhere in the request; the server computes those. `OrderItemResponse`
(`product_id: int`, `name: str`, `price: float`, `quantity: int`).
`OrderResponse` (`id: int`, `user_id: int`, `items:
list[OrderItemResponse]`, `total: float`, `pickup_name`, `pickup_phone`,
`pickup_time`, `status: OrderStatus`, `created_at: datetime`).
`OrderStatusUpdate` (`status: OrderStatus`).

**`app/core/deps.py`** (modified, sub-project 2's file): add
`require_admin(current_user: User = Depends(get_current_user)) -> User`,
raising `403` if `current_user.role != UserRole.ADMIN`.

**`app/api/products.py`** (new, `APIRouter(prefix="/products",
tags=["products"])`):
- `GET /` — no auth dependency, `db.query(Product).all()`.
- `POST /` — `Depends(require_admin)`, insert, return `201`.
- `PUT /{id}` — `Depends(require_admin)`, `db.get(Product, id)` or 404,
  overwrite all `ProductWrite` fields, commit.
- `DELETE /{id}` — `Depends(require_admin)`, `db.get(Product, id)` or
  404, delete, commit, return `204`.

**`app/api/orders.py`** (new, `APIRouter(prefix="/orders",
tags=["orders"])`):
- `POST /` — `Depends(get_current_user)`. For each `OrderItemCreate`,
  `db.get(Product, item.product_id)`; 404
  (`f"Producto {item.product_id} no encontrado"`) if any is missing.
  Build `OrderItem(product_id=..., name=product.name,
  price=product.price, quantity=item.quantity)` for each, `total =
  sum(item.price * item.quantity for item in built_items)`. Insert
  `Order(user_id=current_user.id, items=built_items, total=total,
  pickup_name=..., pickup_phone=..., pickup_time=...)` — `status`
  defaults to `PENDIENTE` at the model level (sub-project 1). Return
  `201`.
- `GET /` — `Depends(get_current_user)`. If `current_user.role ==
  UserRole.ADMIN`: `db.query(Order).order_by(Order.created_at.desc()).all()`.
  Else: same query `.filter(Order.user_id == current_user.id)`.
- `GET /{id}` — `Depends(get_current_user)`. `db.get(Order, id)`; if
  `None`, or (`order.user_id != current_user.id` and `current_user.role
  != UserRole.ADMIN`), raise `404`.
- `PATCH /{id}/status` — `Depends(require_admin)`. `db.get(Order, id)`
  or 404, set `order.status = body.status`, commit.

**`app/main.py`** (modified): mount both new routers alongside the
existing `auth_router`.

`OrderItem.product_id` is already a plain `int` column, not a foreign
key (sub-project 1's deliberate snapshot design — see that spec's
`OrderItem` note): deleting a `Product` never touches existing
`OrderItem` rows, so `DELETE /products/{id}` needs no cascade handling
and no "referenced by an order" guard.

## Testing

TDD, pytest + `TestClient`, reusing the `client`/`db_session` fixtures
from sub-project 2's `conftest.py` (no fixture changes needed). Tests
register/login a user (or seed an admin via `seed_admin(db_session)`)
to get a bearer token where auth is required, and insert `Product` rows
directly via `db_session` where a test needs one to exist first.

Cases per endpoint:
- Products: list (empty, then with rows), create as admin (201), create
  as non-admin (403), create unauthenticated (401), update existing
  (200, fields changed), update missing id (404), update as non-admin
  (403), delete existing (204, then a follow-up list no longer shows
  it), delete missing id (404), delete as non-admin (403).
- Orders: create with valid items (201, `total` matches server-computed
  sum, `user_id` matches the token regardless of any `user_id` the test
  tries to smuggle in the body — there is no such field, so this is
  really "request schema has no `user_id`/`price`/`total` field at
  all"), create with an unknown `product_id` (404), create
  unauthenticated (401), create with an item `quantity <= 0` (422).
  List as admin (sees orders from multiple users), list as customer
  (sees only their own, not another customer's). Get by id as owner
  (200), as a different customer (404), as admin (200, even though not
  the owner). Status update as admin (200, `status` changed), as
  non-admin (403), on a missing id (404), with an invalid status string
  (422).

Manual acceptance: same shape as sub-project 2's Task 6 — `docker
compose up -d`, `uv run uvicorn app.main:app --reload`, `curl` through
register → login (admin) → create product → create order (as a second,
customer-registered user) → list orders as admin → update order status
→ confirm via `GET /orders/{id}`.

## Branch / workflow

Same per-task-branch pattern as sub-project 2: each implementation task
cut from the current tip of `dev` (`feat/product-order-crud-<slug>`),
merged into `dev` as soon as that task's review is clean, branch
deleted, next task branches from the updated `dev`.

## Code style

No comments. Fully type-annotated. Still no service/repository layer —
route handlers query the DB directly, matching sub-project 2's
precedent; revisit only if a genuinely repeated query pattern emerges
across `products.py` and `orders.py` (unlikely at this size).

## Open items resolved during brainstorming

- `GET /products` is public, no auth required.
- API field names are snake_case, not aliased to the frontend's
  camelCase — sub-project 4 maps names when it wires up Angular.
- Order listing is one role-filtered `GET /orders`, not two separate
  routes.
- Order pricing: the server computes `price`/`name`/`total` from live
  `Product` rows at order-creation time; the client only ever sends
  `product_id` + `quantity`. This is a deliberate security hardening
  over the current Firestore version (which trusts client-submitted
  prices) — not required for Firestore parity, chosen anyway.
