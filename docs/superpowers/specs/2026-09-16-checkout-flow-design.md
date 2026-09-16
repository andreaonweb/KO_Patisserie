# Checkout & Orders (Simulated Purchase Flow) — Design

## Context

The app has a fully reactive cart (`CartService`, Signals + localStorage)
with a slide-out panel in the navbar, but the cart never turns into an
actual order — there's no checkout page, no `Order` model, and no
persistence of what a user bought. This is a portfolio project, so we're
not integrating a real payment processor; the goal is a complete,
realistic-looking purchase flow (browse → cart → checkout → confirmed
order) backed by Firestore, the same way products already are.

## Goals

- User can go from cart to a confirmed order: pickup details form →
  order created in Firestore → confirmation screen.
- Delivery model is **pickup-in-store only** (no shipping address).
- Logged-in users can see their own order history (`/pedidos`).
- Admin can see all orders and move each one through a status lifecycle
  (`pendiente` → `listo` → `entregado`) from `/admin`.

## Non-goals

- Real payment processing (Stripe, etc.) — "Hacer pedido" simulates a
  completed purchase, no payment step.
- Shipping / delivery addresses — pickup only.
- Stock/inventory tracking — `Product` has no quantity field today and
  this design doesn't add one; an order doesn't affect product data.
- Order cancellation or editing by the customer.
- Admin role separation — same `authGuard` (any logged-in user) used
  everywhere else in the app today; not introduced here either.

## Data model

New file `core/models/order.model.ts`:

```ts
export type OrderStatus = 'pendiente' | 'listo' | 'entregado';

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  total: number;
  pickupName: string;
  pickupPhone: string;
  pickupTime: string;
  status: OrderStatus;
  createdAt: number;
}
```

`items` is a snapshot (name/price copied at purchase time), not a
reference to `Product` — editing or deleting a product later in `/admin`
must not corrupt historical orders.

Firestore collection: `orders`. Document ID = Firestore auto-id.
`createdAt` is a plain `Date.now()` number (matches the simplicity of the
rest of the app; no `serverTimestamp()` needed for a portfolio project).

## Architecture

### `OrderService` (new — `core/services/order.service.ts`)

Same shape as `ProductService`, wrapping `@angular/fire/firestore`:

- `create(order: Omit<Order, 'id' | 'status' | 'createdAt'>): Promise<string>`
  → `addDoc(ordersRef, { ...order, status: 'pendiente', createdAt: Date.now() })`,
  returns the new doc id.
- `watchByUser(userId: string): Observable<Order[]>` →
  `collectionData(query(ordersRef, where('userId', '==', userId), orderBy('createdAt', 'desc')), { idField: 'id' })`.
- `watchAll(): Observable<Order[]>` →
  `collectionData(query(ordersRef, orderBy('createdAt', 'desc')), { idField: 'id' })`.
- `getById(id: string): Promise<Order | undefined>` → `getDoc(doc(ordersRef, id))`,
  used by the confirmation page.
- `updateStatus(id: string, status: OrderStatus): Promise<void>` →
  `updateDoc(doc(ordersRef, id), { status })`.

`watchByUser`/`watchAll` return `Observable<Order[]>` rather than an
eagerly-created signal (unlike `ProductService.products`), because which
query runs depends on which page is active (a specific user vs. every
order). Each page injects `OrderService` and does its own
`toSignal(orderService.watchByUser(uid), { initialValue: [] })`.

**Firestore index:** the `where(...) + orderBy(...)` combo in
`watchByUser` requires a composite index. The first time it runs,
Firestore throws an error containing a console link that creates the
index with one click — this is a one-time manual setup step, called out
in the PR/README, not something the code needs to handle.

### Checkout page (new — `pages/checkout/checkout.ts`, route `/checkout`)

Guarded by the existing `authGuard`. On init, if `cart.itemCount() === 0`,
redirect to `/menu` (nothing to check out).

- Displays the cart contents and total (same data `CartService` already
  exposes — no new cart UI component needed, a simple list in the page
  template is enough).
- Reactive form: `pickupName` (required), `pickupPhone` (required),
  `pickupTime` (required, plain text input — e.g. "Hoy 18:00", no date
  picker library).
- Submit (valid form): build `OrderItem[]` from `cart.getItems()()`,
  call `orderService.create({ userId: auth.currentUser()!.uid, items, total: cart.total(), pickupName, pickupPhone, pickupTime })`,
  then `cart.clear()`, then `router.navigate(['/checkout/confirmacion', orderId])`.
- Firestore write failure: caught, shown as an inline error signal (same
  pattern as `/admin`), form stays filled so the user can retry.

### Confirmation page (new — `pages/checkout/confirmation.ts`, route
`/checkout/confirmacion/:id`)

Guarded by `authGuard`. Reads `id` from the route, calls
`orderService.getById(id)` once on init (not a live subscription — the
order won't change while this screen is open). Shows a thank-you
message, the order id, items, total, and pickup details. If the id
doesn't resolve to a document (e.g. direct navigation to a bad URL),
shows a simple "pedido no encontrado" message instead of an order.

### Mis pedidos page (new — `pages/orders/orders.ts`, route `/pedidos`)

Guarded by `authGuard`. `orders = toSignal(orderService.watchByUser(auth.currentUser()!.uid), { initialValue: [] })`.
Lists each order: date (from `createdAt`), items, total, and a status
badge (read-only — customers don't change status).

### Admin orders tab (`pages/admin/admin.ts` — extended, not a new page)

Adds a local `activeTab = signal<'productos' | 'pedidos'>('productos')`
and two tab buttons at the top of the existing admin template. The
"Pedidos" tab reuses the same page, no new route:

- `orders = toSignal(orderService.watchAll(), { initialValue: [] })`.
- Table: date, `pickupName`/`pickupPhone`, items summary, total, and a
  `<select>` bound to `status`, calling `orderService.updateStatus(order.id, newStatus)`
  on change.
- No delete/edit of order contents — status is the only mutable field.

### Navbar (`shared/components/navbar/navbar.html` — small edit)

The existing "Hacer pedido ✨" button in the cart panel (currently no
click handler) gets:
- `[routerLink]="'/checkout'"` and `(click)="toggleCart()"` (closes the
  panel on navigation).
- `[disabled]="cart.itemCount() === 0"`.

### Routing (`app.routes.ts`)

Three new lazy routes, all `canActivate: [authGuard]`, following the
existing `loadComponent` pattern:

```ts
{ path: 'checkout', loadComponent: () => import('./pages/checkout/checkout').then(m => m.CheckoutComponent), canActivate: [authGuard] },
{ path: 'checkout/confirmacion/:id', loadComponent: () => import('./pages/checkout/confirmation').then(m => m.ConfirmationComponent), canActivate: [authGuard] },
{ path: 'pedidos', loadComponent: () => import('./pages/orders/orders').then(m => m.OrdersComponent), canActivate: [authGuard] },
```

## Error handling

- Checkout submit and admin status update: Firestore write failures are
  caught and surfaced as an inline error message signal — same
  convention as `/admin`'s product form.
- Confirmation page: missing/invalid order id shows a fallback message
  instead of throwing.
- Checkout page: empty cart redirects to `/menu` rather than showing an
  empty form.

## Testing

Following the existing convention (`product.service.spec.ts` — Vitest
with `@angular/fire/firestore` mocked):

- `order.service.spec.ts`: mocks `collection`/`doc`/`addDoc`/`updateDoc`/
  `collectionData`/`getDoc`/`query`/`where`/`orderBy`; covers `create()`
  (defaults `status` to `'pendiente'`), `watchByUser()`/`watchAll()`
  (query built correctly), `updateStatus()`, `getById()`.
- Basic component specs for `CheckoutComponent`, `ConfirmationComponent`,
  `OrdersComponent`, and the extended `AdminComponent`, matching the
  scaffold style already used by other pages (`menu.spec.ts`,
  `admin.spec.ts`).
- Manual verification via the `run` flow: add items to cart → checkout
  → confirm pickup details → see confirmation screen → check `/pedidos`
  shows the order → check `/admin`'s "Pedidos" tab shows it and status
  changes persist.

## Open items resolved during brainstorming

- Delivery model: pickup-in-store only, no shipping address.
- Post-purchase scope: confirmation screen + "Mis pedidos" history +
  admin order view, all three included.
- Order status: editable by admin (`pendiente`/`listo`/`entregado`),
  read-only for customers.
- Payment: no real payment integration — out of scope for a portfolio
  project; simulated purchase only.
