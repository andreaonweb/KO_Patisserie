# Frontend API Integration (ko_front) — Design

## Context

Continuation of the Firebase → custom backend migration. Sub-project 1
stood up the empty `ko_back` skeleton and models. Sub-project 2 added
authentication (JWT, roles). Sub-project 3 added the business API
(`Product`/`Order` CRUD). This is **sub-project 4a**: swap `ko_front`'s
data layer — `AuthService`, `ProductService`, `OrderService`, and
`authGuard` — from Firebase Auth/Firestore to `ko_back`'s REST API.

This sub-project makes **no visual or UX change**. The existing
`/auth` page, navbar, admin panel, and checkout flow keep behaving
exactly as they do today — same routes, same forms, same look — just
backed by the new API instead of Firebase. The navbar/footer/login
redesign requested earlier (client login in the navbar, admin login
behind a footer "Intranet" button, role-aware dropdown) is
**sub-project 4b**, deliberately kept separate so it can build on real
roles once this sub-project lands them.

## Goals

- `provideHttpClient()` registered in `app.config.ts` (currently
  missing — `BusService` already injects `HttpClient` today and would
  throw `NullInjectorError` the first time it's actually exercised;
  this sub-project fixes that as a side effect of adding the client
  the new services need, not as separate scope).
- A functional HTTP interceptor attaches `Authorization: Bearer
  <token>` to every request and, on a `401` response, clears the
  stored session and redirects to `/auth`.
- `AuthService`: `login`/`register` call `POST /auth/login` /
  `POST /auth/register`, store the returned JWT in `localStorage`,
  then call `GET /auth/me` to populate a `currentUser` signal
  (`{id, email, role}`); `logout` clears the token and redirects.
  Session persists across browser restarts until explicit logout —
  matching how Firebase Auth behaves today.
- `authGuard` checks `AuthService.isLoggedIn()` directly — synchronous,
  no more `Observable`/SDK-init wait, since there's no async Firebase
  bootstrap to race.
- `ProductService`: `GET/POST/PUT/DELETE /products` via `HttpClient`.
  `products` is a signal populated by an explicit load (on service
  construction and after each mutation) rather than a live Firestore
  listener — REST has no push channel, so this sub-project accepts
  losing real-time updates as an inherent consequence of the backend
  swap already chosen, not a regression to fix here. `seedIfEmpty` is
  removed (no bulk-seed endpoint exists on the API by design; not
  needed since the admin creates products one at a time).
- `OrderService`: `POST /orders` (body carries only `product_id`s +
  `quantity`s and pickup info — no price, name, total, or user id, all
  server-derived, matching the API), `GET /orders` role-filtered
  (renamed from `watchAll`/`watchByUser` to `getAll`/`getMine` — REST
  returns a snapshot, not a live stream, so "watch" is no longer an
  accurate name), `GET /orders/{id}`, `PATCH /orders/{id}/status`.
- Field names translated at the service boundary: TypeScript models
  and every component/template stay camelCase (`isNew`, `pickupName`,
  `userId`); only `ProductService`/`OrderService`/`AuthService`
  internals know the API is snake_case. No template changes required
  anywhere in the app for this reason.
- `Product.id`, `Order.id`, `Order.userId`, `OrderItem.productId`
  become `number` (the API's integer ids), not `string`.
- `firebase` and `@angular/fire` removed from `package.json` once
  nothing references them.

## Non-goals

- Any visual/UX change to the navbar, footer, login page, or admin
  panel — sub-project 4b.
- Role-based route protection beyond what already exists (the `/admin`
  route already uses `authGuard`; making it admin-only specifically,
  rather than any-logged-in-user, is a 4b concern tied to the new
  nav/role UI, not a 4a data-layer concern).
- Real-time product/order updates (websockets, polling) — accepted
  trade-off, not deferred work.
- Any change to `ko_back` — this sub-project only consumes the
  existing API from sub-projects 2 and 3.
- `CartService` — purely `localStorage`-backed, no Firebase dependency,
  untouched.
- `BusService` — unrelated external API (TMB), untouched beyond
  benefiting from `provideHttpClient()` now actually being registered.

## Architecture

**`app.config.ts`:** remove the three Firebase providers
(`provideFirebaseApp`, `provideAuth`, `provideFirestore`); add
`provideHttpClient(withInterceptors([authInterceptor]))`.

**`environments/environment.ts` / `environment.example.ts`:** remove
the `firebase` block; add `apiUrl: 'http://localhost:8000'` alongside
the existing `tmb` block.

**`app/core/interceptors/auth.interceptor.ts`** (new): a functional
`HttpInterceptorFn`. For requests whose URL starts with
`environment.apiUrl`, reads the stored token and sets the
`Authorization` header if present. On a `401` response from such a
request, clears the stored token and navigates to `/auth` (via
`inject(Router)`), then re-throws so the calling code's own error
handling still runs.

**`app/core/models/user.model.ts`:** `AppUser { id: number; email:
string; role: 'admin' | 'customer' }` (replaces the Firebase-era `uid`/
`displayName` shape).

**`app/core/models/product.model.ts`:** `id: number` (was `string`);
every other field unchanged.

**`app/core/models/order.model.ts`:** `id: number`, `userId: number`
(was `string`); `OrderItem.productId: number` (was `string`); every
other field unchanged.

**`app/core/services/auth.service.ts`** (rewritten): `login`/`register`
`POST` to `${apiUrl}/auth/login` / `/auth/register` with `{email,
password}`, store `response.access_token` under a fixed
`localStorage` key, then `GET /auth/me` to populate `currentUser`
(mapped from the API's `{id, email, role}` — already camelCase-safe
field names, no translation needed here) and navigate to `/home`.
`logout` removes the token, clears `currentUser`, navigates to
`/auth`. `currentUser` is a plain signal (not `toSignal(user(auth))`
— there's no SDK observable anymore); it is populated eagerly on
service construction if a token already exists in storage (calls
`/auth/me` once at startup), so a page refresh doesn't lose the
session — matching Firebase's automatic session restore.

**`app/core/guards/auth.guard.ts`** (rewritten): `inject(AuthService)`,
return `true` if `isLoggedIn()`, else `router.navigate(['/auth'])` and
return `false`. No `Observable`, no `authState`.

**`app/core/services/product.service.ts`** (rewritten): `products =
signal<Product[]>([])`; `load()` (private, called from the
constructor and after every mutation) does `GET /products`, maps each
row's `is_new`→`isNew` (all other fields already match), sets the
signal. `create`/`update`/`remove` call `POST`/`PUT`/`DELETE`
(mapping `isNew`→`is_new` outbound), then call `load()` to refresh.

**`app/core/services/order.service.ts`** (rewritten): `create(order)`
maps `{items: [{productId, quantity}], pickupName, pickupPhone,
pickupTime}` → the API's `{items: [{product_id, quantity}],
pickup_name, pickup_phone, pickup_time}`, `POST /orders`, returns the
created order's `id` (mapped back from the response). `getMine()` →
`GET /orders` (the API already filters by caller role — customer sees
only their own), maps each row back to the camelCase `Order` shape,
returns `Observable<Order[]>` via `HttpClient`'s native `Observable`
return type (no more manual Firestore `collectionData` wiring).
`getAll()` → same endpoint, semantically identical from the client's
perspective (the backend does the role split; the frontend just calls
`GET /orders` either way) — kept as a separate method name only
because `admin.ts` and `orders.ts` call it with different intent, both
map to the same HTTP call. `getById(id: number)` → `GET
/orders/{id}`. `updateStatus(id: number, status: OrderStatus)` →
`PATCH /orders/{id}/status`.

**Consumers updated** (signatures only, no template changes):
- `pages/orders/orders.ts`: `orderService.getMine()` replaces
  `watchByUser(auth.currentUser()!.uid)` — the backend derives the
  caller from the token, so no id needs to be passed at all.
- `pages/admin/admin.ts`: `orderService.getAll()` replaces `watchAll()`;
  the "sembrar productos" button and its handler (calling the removed
  `seedIfEmpty`) are deleted from both `admin.ts` and `admin.html`.
- `pages/checkout/checkout.ts`: builds `{items: cartItems().map(i =>
  ({productId: i.product.id, quantity: i.quantity})), pickupName,
  pickupPhone, pickupTime}` — no `userId`, no per-item `price`/`name`,
  no `total`, matching the new `OrderService.create` signature.
- `pages/checkout/confirmation.ts`: `Number(route.snapshot.paramMap.get('id'))`
  before calling `getById` (route params are always strings; the
  service now takes a `number`).

**`package.json`:** `firebase` and `@angular/fire` removed from
`dependencies` once no file imports from `@angular/fire/*`.

## Testing

Vitest, same runner as today. `product.service.spec.ts` and
`order.service.spec.ts` are rewritten using Angular's standard HTTP
testing pattern — `provideHttpClientTesting()` +
`HttpTestingController` (`expectOne`, `.flush(...)`) — replacing the
current `vi.mock('@angular/fire/firestore', ...)` approach. A new
`auth.service.spec.ts` is added the same way (none exists today).
Page specs that currently stub the old Firebase-shaped service methods
(`admin.spec.ts`, `checkout.spec.ts`, `confirmation.spec.ts`,
`orders.spec.ts`, and any others touching these services) get their
mocks updated to the new method names/signatures — no assertions about
rendered markup should need to change, since no template changes.

Manual acceptance: run `ko_back` (Postgres + `uvicorn`) and `ko_front`
(`ng serve`) together; log in, browse the menu, add to cart, check
out, view "Mis pedidos", log in as the seeded admin, create/edit/delete
a product, view all orders, change an order's status — confirming the
existing UI still works end to end against the new backend.

## Branch / workflow

Same per-task-branch pattern as sub-projects 2 and 3: each
implementation task cut from the current tip of `dev`
(`feat/frontend-api-<slug>`), merged into `dev` as soon as that task's
review is clean, branch deleted, next task branches from the updated
`dev`.

## Code style

Follows `ko_front`'s existing conventions (standalone components,
signals, no `NgModule`s). No comments beyond what's already the
project's practice. No new abstraction layer beyond the
interceptor — the service-level field-mapping stays inline in each
service (small, single-purpose, not worth a shared mapper utility at
this size).

## Open items resolved during brainstorming

- Split confirmed: 4a (data layer only) / 4b (navbar/footer/login UI),
  not one combined sub-project.
- Field naming: translate at the service boundary, keep TS models and
  templates camelCase — not a snake_case rename across the app.
- Token storage: `localStorage`, matching Firebase Auth's current
  persist-until-logout behavior.
