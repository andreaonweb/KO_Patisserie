# Checkout & Orders Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing cart into a full simulated purchase flow — checkout with pickup details, an order persisted in Firestore, a confirmation screen, an order-history page for customers, and an order-management tab in `/admin`.

**Architecture:** Add an `Order` model and an `OrderService` (Firestore-backed, same shape as the existing `ProductService`). Add three new routed pages (`/checkout`, `/checkout/confirmacion/:id`, `/pedidos`), wire the already-present "Hacer pedido" button in the navbar's cart panel to `/checkout`, and extend the existing `/admin` page with a second tab that lists and updates orders.

**Tech Stack:** Angular 21 (standalone components, Signals, Reactive Forms), `@angular/fire/firestore`, Vitest (via `@angular/build:unit-test`).

**Spec:** `docs/superpowers/specs/2026-09-16-checkout-flow-design.md`

## Global Constraints

- No NgModules — every component is `standalone: true`, matching every existing page/component in this repo.
- No new backend — Firestore (`@angular/fire/firestore`) is the only persistence layer, same as `ProductService`.
- Delivery model is pickup-in-store only — no shipping address fields anywhere.
- No real payment integration — "Hacer pedido" simulates a completed purchase.
- Every route touched here is guarded by the existing `authGuard` (`src/app/core/guards/auth.guard.ts`), the same guard already used for `/menu` and `/admin`.
- Service tests mock `@angular/fire/firestore` at the module level with `vi.mock(...)`, exactly like `src/app/core/services/product.service.spec.ts`.
- Component tests provide hand-written Fake service classes via `TestBed`, exactly like `src/app/pages/admin/admin.spec.ts` (no test double libraries).
- Run the whole suite after every step with: `npx ng test --watch=false`.
- Firestore's `watchByUser` query needs a composite index (`userId` + `createdAt`); Firestore will print a console link to create it the first time it runs against a real project — this is a manual one-time setup step, not something to script.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/app/core/models/order.model.ts` | `Order`, `OrderItem`, `OrderStatus` types |
| `src/app/core/services/order.service.ts` | Firestore CRUD/queries for orders |
| `src/app/core/services/order.service.spec.ts` | Unit tests for the above |
| `src/app/pages/checkout/checkout.ts/.html/.scss` | Pickup form + cart summary → creates the order |
| `src/app/pages/checkout/checkout.spec.ts` | Unit tests |
| `src/app/pages/checkout/confirmation.ts/.html/.scss` | Post-purchase confirmation screen |
| `src/app/pages/checkout/confirmation.spec.ts` | Unit tests |
| `src/app/pages/orders/orders.ts/.html/.scss` | "Mis pedidos" — customer order history |
| `src/app/pages/orders/orders.spec.ts` | Unit tests |
| `src/app/shared/components/navbar/navbar.html` | Wire the existing "Hacer pedido" button to `/checkout` |
| `src/app/shared/components/navbar/navbar.spec.ts` | Fix pre-existing DI failure + cover the new wiring |
| `src/app/pages/admin/admin.ts/.html/.scss` | Add a "Pedidos" tab (list + status update) |
| `src/app/pages/admin/admin.spec.ts` | New tests for the tab |
| `src/app/app.routes.ts` | New routes for checkout, confirmation, and `/pedidos` |

---

### Task 1: `Order` model + `OrderService`

**Files:**
- Create: `src/app/core/models/order.model.ts`
- Create: `src/app/core/services/order.service.ts`
- Test: `src/app/core/services/order.service.spec.ts`

**Interfaces:**
- Produces: `Order`, `OrderItem`, `OrderStatus` (from `order.model.ts`); `OrderService` with `create(order: Omit<Order,'id'|'status'|'createdAt'>): Promise<string>`, `watchByUser(userId: string): Observable<Order[]>`, `watchAll(): Observable<Order[]>`, `getById(id: string): Promise<Order | undefined>`, `updateStatus(id: string, status: OrderStatus): Promise<void>`.

- [ ] **Step 1: Create the `Order` model**

`src/app/core/models/order.model.ts`:

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

- [ ] **Step 2: Write the failing test**

`src/app/core/services/order.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Firestore } from '@angular/fire/firestore';
import { OrderService } from './order.service';
import type { Order } from '../models/order.model';

const mockCollection = vi.fn().mockReturnValue('orders-collection');
const mockDoc = vi.fn().mockReturnValue('order-doc-ref');
const mockAddDoc = vi.fn().mockResolvedValue({ id: 'new-order-id' });
const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);
const mockGetDoc = vi.fn();
const mockQuery = vi.fn().mockReturnValue('orders-query');
const mockWhere = vi.fn().mockReturnValue('where-userId');
const mockOrderBy = vi.fn().mockReturnValue('orderBy-createdAt');
const mockCollectionData = vi.fn().mockReturnValue(of([]));

vi.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  collectionData: (...args: unknown[]) => mockCollectionData(...args),
}));

const SAMPLE_ORDER_INPUT = {
  userId: 'user-1',
  items: [{ productId: 'p1', name: 'Mochi de Fresa', price: 3.5, quantity: 2 }],
  total: 7,
  pickupName: 'Ana',
  pickupPhone: '600111222',
  pickupTime: 'Hoy 18:00',
};

function createService(): OrderService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [OrderService, { provide: Firestore, useValue: {} }],
  });
  return TestBed.inject(OrderService);
}

describe('OrderService', () => {
  beforeEach(() => {
    mockCollection.mockClear();
    mockDoc.mockClear();
    mockAddDoc.mockClear();
    mockUpdateDoc.mockClear();
    mockGetDoc.mockClear();
    mockQuery.mockClear();
    mockWhere.mockClear();
    mockOrderBy.mockClear();
    mockCollectionData.mockClear();
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  it('should create', () => {
    expect(createService()).toBeTruthy();
  });

  it('create() adds a document with status "pendiente" and the current timestamp', async () => {
    const service = createService();
    const id = await service.create(SAMPLE_ORDER_INPUT);
    expect(mockAddDoc).toHaveBeenCalledWith('orders-collection', {
      ...SAMPLE_ORDER_INPUT,
      status: 'pendiente',
      createdAt: 1700000000000,
    });
    expect(id).toBe('new-order-id');
  });

  it('watchByUser() queries by userId ordered by createdAt desc', () => {
    const service = createService();
    service.watchByUser('user-1');
    expect(mockWhere).toHaveBeenCalledWith('userId', '==', 'user-1');
    expect(mockOrderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(mockQuery).toHaveBeenCalledWith('orders-collection', 'where-userId', 'orderBy-createdAt');
    expect(mockCollectionData).toHaveBeenCalledWith('orders-query', { idField: 'id' });
  });

  it('watchAll() queries every order ordered by createdAt desc', () => {
    const service = createService();
    service.watchAll();
    expect(mockOrderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(mockQuery).toHaveBeenCalledWith('orders-collection', 'orderBy-createdAt');
    expect(mockCollectionData).toHaveBeenCalledWith('orders-query', { idField: 'id' });
  });

  it('updateStatus() writes the new status to the order document', async () => {
    const service = createService();
    await service.updateStatus('order-1', 'listo');
    expect(mockDoc).toHaveBeenCalledWith('orders-collection', 'order-1');
    expect(mockUpdateDoc).toHaveBeenCalledWith('order-doc-ref', { status: 'listo' });
  });

  it('getById() returns the order when the document exists', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      id: 'order-1',
      data: () => ({ ...SAMPLE_ORDER_INPUT, status: 'pendiente', createdAt: 1700000000000 }),
    });
    const service = createService();
    const order = await service.getById('order-1');
    expect(mockDoc).toHaveBeenCalledWith('orders-collection', 'order-1');
    expect(order).toEqual<Order>({
      id: 'order-1',
      ...SAMPLE_ORDER_INPUT,
      status: 'pendiente',
      createdAt: 1700000000000,
    });
  });

  it('getById() returns undefined when the document does not exist', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    const service = createService();
    const order = await service.getById('missing');
    expect(order).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx ng test --watch=false`
Expected: FAIL — `Cannot find module './order.service'` (file doesn't exist yet).

- [ ] **Step 4: Implement `OrderService`**

`src/app/core/services/order.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  query,
  where,
  orderBy,
  collectionData,
} from '@angular/fire/firestore';
import type { Observable } from 'rxjs';
import type { Order, OrderStatus } from '../models/order.model';

const COLLECTION = 'orders';

@Injectable({ providedIn: 'root' })
export class OrderService {
  private firestore = inject(Firestore);
  private ordersRef = collection(this.firestore, COLLECTION);

  async create(order: Omit<Order, 'id' | 'status' | 'createdAt'>): Promise<string> {
    const docRef = await addDoc(this.ordersRef, {
      ...order,
      status: 'pendiente' as OrderStatus,
      createdAt: Date.now(),
    });
    return docRef.id;
  }

  watchByUser(userId: string): Observable<Order[]> {
    const q = query(this.ordersRef, where('userId', '==', userId), orderBy('createdAt', 'desc'));
    return collectionData(q, { idField: 'id' }) as Observable<Order[]>;
  }

  watchAll(): Observable<Order[]> {
    const q = query(this.ordersRef, orderBy('createdAt', 'desc'));
    return collectionData(q, { idField: 'id' }) as Observable<Order[]>;
  }

  async getById(id: string): Promise<Order | undefined> {
    const snap = await getDoc(doc(this.ordersRef, id));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as Order) : undefined;
  }

  async updateStatus(id: string, status: OrderStatus): Promise<void> {
    await updateDoc(doc(this.ordersRef, id), { status });
  }
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx ng test --watch=false`
Expected: PASS — all `OrderService` tests green.

- [ ] **Step 6: Commit**

```bash
git add src/app/core/models/order.model.ts src/app/core/services/order.service.ts src/app/core/services/order.service.spec.ts
git commit -m "feat(orders): add Order model and OrderService"
```

---

### Task 2: Checkout page

**Files:**
- Create: `src/app/pages/checkout/checkout.ts`
- Create: `src/app/pages/checkout/checkout.html`
- Create: `src/app/pages/checkout/checkout.scss`
- Test: `src/app/pages/checkout/checkout.spec.ts`
- Modify: `src/app/app.routes.ts`

**Interfaces:**
- Consumes: `OrderService.create(...)` (Task 1), `CartService.getItems()/itemCount()/total()/clear()` (existing), `AuthService.currentUser()` (existing).
- Produces: `CheckoutComponent` at route `/checkout`.

- [ ] **Step 1: Write the failing test**

`src/app/pages/checkout/checkout.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { CheckoutComponent } from './checkout';
import { AuthService } from '../../core/services/auth.service';
import { CartService } from '../../core/services/cart.service';
import type { CartItem } from '../../core/services/cart.service';
import { OrderService } from '../../core/services/order.service';
import type { Product } from '../../core/models/product.model';

const SAMPLE_PRODUCT: Product = {
  id: 'p1',
  name: 'Mochi de Fresa',
  price: 3.5,
  description: 'Tierno mochi relleno de anko y fresas frescas.',
  emoji: '🍓',
  category: 'mochi',
};

class FakeAuthService {
  currentUser = signal<{ uid: string } | undefined>({ uid: 'user-1' });
}

class FakeCartService {
  items = signal<CartItem[]>([{ product: SAMPLE_PRODUCT, quantity: 2 }]);
  itemCount = computed(() => this.items().reduce((sum, i) => sum + i.quantity, 0));
  total = computed(() => this.items().reduce((sum, i) => sum + i.product.price * i.quantity, 0));
  getItems() {
    return this.items.asReadonly();
  }
  clear = vi.fn();
}

class FakeOrderService {
  create = vi.fn().mockResolvedValue('order-1');
}

describe('CheckoutComponent', () => {
  let component: CheckoutComponent;
  let fixture: ComponentFixture<CheckoutComponent>;
  let cart: FakeCartService;
  let orderService: FakeOrderService;
  let router: { navigate: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    router = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [CheckoutComponent],
      providers: [
        { provide: AuthService, useClass: FakeAuthService },
        { provide: CartService, useClass: FakeCartService },
        { provide: OrderService, useClass: FakeOrderService },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CheckoutComponent);
    component = fixture.componentInstance;
    cart = TestBed.inject(CartService) as unknown as FakeCartService;
    orderService = TestBed.inject(OrderService) as unknown as FakeOrderService;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('redirects to /menu when the cart is empty', () => {
    cart.items.set([]);
    component.ngOnInit();
    expect(router.navigate).toHaveBeenCalledWith(['/menu']);
  });

  it('does not redirect when the cart has items', () => {
    component.ngOnInit();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('form is invalid when required fields are empty', () => {
    expect(component.form.invalid).toBe(true);
  });

  it('submit() does nothing when the form is invalid', async () => {
    await component.submit();
    expect(orderService.create).not.toHaveBeenCalled();
  });

  it('submit() creates the order from the cart and form, clears the cart, and navigates to confirmation', async () => {
    component.form.setValue({ pickupName: 'Ana', pickupPhone: '600111222', pickupTime: 'Hoy 18:00' });

    await component.submit();

    expect(orderService.create).toHaveBeenCalledWith({
      userId: 'user-1',
      items: [{ productId: 'p1', name: 'Mochi de Fresa', price: 3.5, quantity: 2 }],
      total: 7,
      pickupName: 'Ana',
      pickupPhone: '600111222',
      pickupTime: 'Hoy 18:00',
    });
    expect(cart.clear).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/checkout/confirmacion', 'order-1']);
  });

  it('submit() shows an error and does not clear the cart when the order fails to save', async () => {
    orderService.create.mockRejectedValue(new Error('network down'));
    component.form.setValue({ pickupName: 'Ana', pickupPhone: '600111222', pickupTime: 'Hoy 18:00' });

    await component.submit();

    expect(component.error()).toContain('network down');
    expect(cart.clear).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx ng test --watch=false`
Expected: FAIL — `Cannot find module './checkout'`.

- [ ] **Step 3: Implement `CheckoutComponent`**

`src/app/pages/checkout/checkout.ts`:

```ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';
import { CartService } from '../../core/services/cart.service';
import { OrderService } from '../../core/services/order.service';
import type { OrderItem } from '../../core/models/order.model';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [ReactiveFormsModule, CurrencyPipe],
  templateUrl: './checkout.html',
  styleUrl: './checkout.scss',
})
export class CheckoutComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private auth = inject(AuthService);
  private orderService = inject(OrderService);
  cart = inject(CartService);

  cartItems = this.cart.getItems();
  error = signal('');
  saving = signal(false);

  form = this.fb.nonNullable.group({
    pickupName: ['', Validators.required],
    pickupPhone: ['', Validators.required],
    pickupTime: ['', Validators.required],
  });

  ngOnInit(): void {
    if (this.cart.itemCount() === 0) {
      this.router.navigate(['/menu']);
    }
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.error.set('');
    const items: OrderItem[] = this.cartItems().map(i => ({
      productId: i.product.id,
      name: i.product.name,
      price: i.product.price,
      quantity: i.quantity,
    }));
    try {
      const orderId = await this.orderService.create({
        userId: this.auth.currentUser()!.uid,
        items,
        total: this.cart.total(),
        ...this.form.getRawValue(),
      });
      this.cart.clear();
      this.router.navigate(['/checkout/confirmacion', orderId]);
    } catch (e: any) {
      this.error.set('❌ ' + (e.message ?? 'Error al confirmar el pedido'));
    } finally {
      this.saving.set(false);
    }
  }
}
```

`src/app/pages/checkout/checkout.html`:

```html
<section class="checkout">
  <div class="checkout__header">
    <h1>Confirmar pedido</h1>
    <p>Retiro en tienda · Revisá tu pedido y dejanos tus datos</p>
  </div>

  @if (error()) {
  <p class="checkout__error">{{ error() }}</p>
  }

  <ul class="checkout__summary">
    @for (item of cartItems(); track item.product.id) {
    <li class="checkout__item">
      <span class="checkout__item-emoji">{{ item.product.emoji }}</span>
      <div class="checkout__item-info">
        <p class="checkout__item-name">{{ item.product.name }}</p>
        <p class="checkout__item-qty">{{ item.product.price | currency:'EUR' }} × {{ item.quantity }}</p>
      </div>
    </li>
    }
  </ul>

  <p class="checkout__total">Total: {{ cart.total() | currency:'EUR' }}</p>

  <form class="checkout__form" [formGroup]="form" (ngSubmit)="submit()">
    <div class="checkout__field">
      <label for="pickupName">Nombre</label>
      <input id="pickupName" type="text" formControlName="pickupName" />
    </div>

    <div class="checkout__field">
      <label for="pickupPhone">Teléfono</label>
      <input id="pickupPhone" type="tel" formControlName="pickupPhone" />
    </div>

    <div class="checkout__field">
      <label for="pickupTime">Horario de retiro</label>
      <input id="pickupTime" type="text" placeholder="Ej: Hoy 18:00" formControlName="pickupTime" />
    </div>

    <button type="submit" class="checkout__submit" [disabled]="form.invalid || saving()">
      {{ saving() ? 'Confirmando…' : 'Hacer pedido ✨' }}
    </button>
  </form>
</section>
```

`src/app/pages/checkout/checkout.scss`:

```scss
@use '../../../styles/variables' as *;
@use '../../../styles/mixins' as *;

.checkout {
  max-width: 560px;
  margin: 3rem auto;
  padding: 0 1.5rem;

  &__header {
    text-align: center;
    margin-bottom: 2rem;

    h1 {
      font-size: 2rem;
      margin-bottom: 0.25rem;
    }

    p {
      color: $text-muted;
      margin: 0;
    }
  }

  &__error {
    background: #fdeceb;
    color: #c0392b;
    padding: 0.75rem 1rem;
    border-radius: $radius-sm;
    margin-bottom: 1rem;
  }

  &__summary {
    list-style: none;
    @include card;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0;

    &:not(:last-child) {
      border-bottom: 1px solid $border;
    }
  }

  &__item-emoji {
    font-size: 1.5rem;
  }

  &__item-name {
    font-weight: 600;
  }

  &__item-qty {
    color: $text-muted;
    font-size: 0.85rem;
  }

  &__total {
    text-align: right;
    font-weight: 700;
    margin-bottom: 1.5rem;
  }

  &__form {
    @include card;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;

    label {
      font-size: 0.85rem;
      font-weight: 600;
      color: $text-dark;
    }

    input {
      border: 1px solid $border;
      border-radius: $radius-sm;
      padding: 0.5rem 0.75rem;
      font-family: $font-main;
      font-size: 0.9rem;
    }
  }

  &__submit {
    @include btn-primary;

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
}
```

- [ ] **Step 4: Add the route**

In `src/app/app.routes.ts`, add before the `{ path: '**', ... }` line:

```ts
  {
    path: 'checkout',
    loadComponent: () => import('./pages/checkout/checkout').then(m => m.CheckoutComponent),
    canActivate: [authGuard],
  },
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx ng test --watch=false`
Expected: PASS — all `CheckoutComponent` tests green.

- [ ] **Step 6: Commit**

```bash
git add src/app/pages/checkout/checkout.ts src/app/pages/checkout/checkout.html src/app/pages/checkout/checkout.scss src/app/pages/checkout/checkout.spec.ts src/app/app.routes.ts
git commit -m "feat(checkout): add checkout page that creates an order from the cart"
```

---

### Task 3: Confirmation page

**Files:**
- Create: `src/app/pages/checkout/confirmation.ts`
- Create: `src/app/pages/checkout/confirmation.html`
- Create: `src/app/pages/checkout/confirmation.scss`
- Test: `src/app/pages/checkout/confirmation.spec.ts`
- Modify: `src/app/app.routes.ts`

**Interfaces:**
- Consumes: `OrderService.getById(id: string)` (Task 1).
- Produces: `ConfirmationComponent` at route `/checkout/confirmacion/:id`.

- [ ] **Step 1: Write the failing test**

`src/app/pages/checkout/confirmation.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { ConfirmationComponent } from './confirmation';
import { OrderService } from '../../core/services/order.service';
import type { Order } from '../../core/models/order.model';

const SAMPLE_ORDER: Order = {
  id: 'order-1',
  userId: 'user-1',
  items: [{ productId: 'p1', name: 'Mochi de Fresa', price: 3.5, quantity: 2 }],
  total: 7,
  pickupName: 'Ana',
  pickupPhone: '600111222',
  pickupTime: 'Hoy 18:00',
  status: 'pendiente',
  createdAt: 1700000000000,
};

function activatedRouteStub(id: string) {
  return { snapshot: { paramMap: { get: (key: string) => (key === 'id' ? id : null) } } };
}

describe('ConfirmationComponent', () => {
  let component: ConfirmationComponent;
  let fixture: ComponentFixture<ConfirmationComponent>;
  let getById: ReturnType<typeof vi.fn>;

  async function setup(id: string, order: Order | undefined) {
    getById = vi.fn().mockResolvedValue(order);
    await TestBed.configureTestingModule({
      imports: [ConfirmationComponent],
      providers: [
        { provide: OrderService, useValue: { getById } },
        { provide: ActivatedRoute, useValue: activatedRouteStub(id) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmationComponent);
    component = fixture.componentInstance;
  }

  it('should create', async () => {
    await setup('order-1', SAMPLE_ORDER);
    expect(component).toBeTruthy();
  });

  it('starts in a loading state with no order', async () => {
    await setup('order-1', SAMPLE_ORDER);
    expect(component.loading()).toBe(true);
    expect(component.order()).toBeUndefined();
  });

  it('loads the order by the route id and stops loading', async () => {
    await setup('order-1', SAMPLE_ORDER);
    await component.ngOnInit();
    expect(getById).toHaveBeenCalledWith('order-1');
    expect(component.order()).toEqual(SAMPLE_ORDER);
    expect(component.loading()).toBe(false);
  });

  it('leaves order() undefined when no order matches the id', async () => {
    await setup('missing', undefined);
    await component.ngOnInit();
    expect(component.order()).toBeUndefined();
    expect(component.loading()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx ng test --watch=false`
Expected: FAIL — `Cannot find module './confirmation'`.

- [ ] **Step 3: Implement `ConfirmationComponent`**

`src/app/pages/checkout/confirmation.ts`:

```ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import { OrderService } from '../../core/services/order.service';
import type { Order } from '../../core/models/order.model';

@Component({
  selector: 'app-confirmation',
  standalone: true,
  imports: [CurrencyPipe],
  templateUrl: './confirmation.html',
  styleUrl: './confirmation.scss',
})
export class ConfirmationComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private orderService = inject(OrderService);

  order = signal<Order | undefined>(undefined);
  loading = signal(true);

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.order.set(await this.orderService.getById(id));
    this.loading.set(false);
  }
}
```

`src/app/pages/checkout/confirmation.html`:

```html
<section class="confirmation">
  @if (loading()) {
  <p class="confirmation__loading">Cargando tu pedido…</p>
  } @else if (!order()) {
  <p class="confirmation__not-found">No encontramos ese pedido 🌸</p>
  } @else {
  <div class="confirmation__card">
    <h1>¡Gracias por tu pedido! 🌸</h1>
    <p class="confirmation__id">Pedido #{{ order()!.id }}</p>

    <ul class="confirmation__items">
      @for (item of order()!.items; track item.productId) {
      <li>{{ item.name }} × {{ item.quantity }} — {{ item.price * item.quantity | currency:'EUR' }}</li>
      }
    </ul>

    <p class="confirmation__total">Total: {{ order()!.total | currency:'EUR' }}</p>

    <div class="confirmation__pickup">
      <p><strong>Retiro en tienda</strong></p>
      <p>{{ order()!.pickupName }} · {{ order()!.pickupPhone }}</p>
      <p>{{ order()!.pickupTime }}</p>
    </div>
  </div>
  }
</section>
```

`src/app/pages/checkout/confirmation.scss`:

```scss
@use '../../../styles/variables' as *;
@use '../../../styles/mixins' as *;

.confirmation {
  max-width: 480px;
  margin: 4rem auto;
  padding: 0 1.5rem;
  text-align: center;

  &__loading,
  &__not-found {
    color: $text-muted;
  }

  &__card {
    @include card;
    padding: 2rem;

    h1 {
      font-size: 1.6rem;
      margin-bottom: 0.5rem;
    }
  }

  &__id {
    color: $text-muted;
    margin-bottom: 1.5rem;
  }

  &__items {
    list-style: none;
    text-align: left;
    margin-bottom: 1rem;

    li {
      padding: 0.35rem 0;
      border-bottom: 1px solid $border;
    }
  }

  &__total {
    font-weight: 700;
    margin-bottom: 1.5rem;
  }

  &__pickup {
    background: $secondary;
    border-radius: $radius-sm;
    padding: 1rem;

    p {
      margin: 0.15rem 0;
    }
  }
}
```

- [ ] **Step 4: Add the route**

In `src/app/app.routes.ts`, add right after the `checkout` route from Task 2:

```ts
  {
    path: 'checkout/confirmacion/:id',
    loadComponent: () => import('./pages/checkout/confirmation').then(m => m.ConfirmationComponent),
    canActivate: [authGuard],
  },
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx ng test --watch=false`
Expected: PASS — all `ConfirmationComponent` tests green.

- [ ] **Step 6: Commit**

```bash
git add src/app/pages/checkout/confirmation.ts src/app/pages/checkout/confirmation.html src/app/pages/checkout/confirmation.scss src/app/pages/checkout/confirmation.spec.ts src/app/app.routes.ts
git commit -m "feat(checkout): add order confirmation page"
```

---

### Task 4: "Mis pedidos" order history page

**Files:**
- Create: `src/app/pages/orders/orders.ts`
- Create: `src/app/pages/orders/orders.html`
- Create: `src/app/pages/orders/orders.scss`
- Test: `src/app/pages/orders/orders.spec.ts`
- Modify: `src/app/app.routes.ts`

**Interfaces:**
- Consumes: `OrderService.watchByUser(userId: string)` (Task 1), `AuthService.currentUser()` (existing).
- Produces: `OrdersComponent` at route `/pedidos`.

- [ ] **Step 1: Write the failing test**

`src/app/pages/orders/orders.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { OrdersComponent } from './orders';
import { AuthService } from '../../core/services/auth.service';
import { OrderService } from '../../core/services/order.service';
import type { Order } from '../../core/models/order.model';

const SAMPLE_ORDERS: Order[] = [
  {
    id: 'order-1',
    userId: 'user-1',
    items: [{ productId: 'p1', name: 'Mochi de Fresa', price: 3.5, quantity: 2 }],
    total: 7,
    pickupName: 'Ana',
    pickupPhone: '600111222',
    pickupTime: 'Hoy 18:00',
    status: 'pendiente',
    createdAt: 1700000000000,
  },
];

class FakeAuthService {
  currentUser = signal<{ uid: string } | undefined>({ uid: 'user-1' });
}

describe('OrdersComponent', () => {
  let component: OrdersComponent;
  let fixture: ComponentFixture<OrdersComponent>;
  let watchByUser: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    watchByUser = vi.fn().mockReturnValue(of(SAMPLE_ORDERS));

    await TestBed.configureTestingModule({
      imports: [OrdersComponent],
      providers: [
        { provide: AuthService, useClass: FakeAuthService },
        { provide: OrderService, useValue: { watchByUser } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrdersComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('watches orders for the current user', () => {
    expect(watchByUser).toHaveBeenCalledWith('user-1');
    expect(component.orders()).toEqual(SAMPLE_ORDERS);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx ng test --watch=false`
Expected: FAIL — `Cannot find module './orders'`.

- [ ] **Step 3: Implement `OrdersComponent`**

`src/app/pages/orders/orders.ts`:

```ts
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';
import { OrderService } from '../../core/services/order.service';
import type { Order } from '../../core/models/order.model';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CurrencyPipe, DatePipe],
  templateUrl: './orders.html',
  styleUrl: './orders.scss',
})
export class OrdersComponent {
  private auth = inject(AuthService);
  private orderService = inject(OrderService);

  orders = toSignal(
    this.orderService.watchByUser(this.auth.currentUser()!.uid),
    { initialValue: [] as Order[] }
  );
}
```

`src/app/pages/orders/orders.html`:

```html
<section class="orders">
  <div class="orders__header">
    <h1>Mis pedidos</h1>
    <p>Historial de tus compras en Shirayuki 🌸</p>
  </div>

  @if (orders().length === 0) {
  <p class="orders__empty">Todavía no hiciste ningún pedido.</p>
  } @else {
  <ul class="orders__list">
    @for (order of orders(); track order.id) {
    <li class="orders__item">
      <div class="orders__item-header">
        <span>{{ order.createdAt | date:'d MMM y, HH:mm' }}</span>
        <span class="orders__status orders__status--{{ order.status }}">{{ order.status }}</span>
      </div>
      <ul class="orders__item-products">
        @for (item of order.items; track item.productId) {
        <li>{{ item.name }} × {{ item.quantity }}</li>
        }
      </ul>
      <p class="orders__item-total">Total: {{ order.total | currency:'EUR' }}</p>
    </li>
    }
  </ul>
  }
</section>
```

`src/app/pages/orders/orders.scss`:

```scss
@use '../../../styles/variables' as *;
@use '../../../styles/mixins' as *;

.orders {
  max-width: 640px;
  margin: 3rem auto;
  padding: 0 1.5rem;

  &__header {
    text-align: center;
    margin-bottom: 2rem;

    h1 {
      font-size: 2rem;
      margin-bottom: 0.25rem;
    }

    p {
      color: $text-muted;
      margin: 0;
    }
  }

  &__empty {
    text-align: center;
    color: $text-muted;
  }

  &__list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  &__item {
    @include card;
    padding: 1rem 1.25rem;
  }

  &__item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
    font-size: 0.85rem;
    color: $text-muted;
  }

  &__status {
    border-radius: $radius-xl;
    padding: 0.2rem 0.7rem;
    font-weight: 600;
    background: $secondary;

    &--listo {
      background: $accent-light;
      color: $accent;
    }

    &--entregado {
      background: $border;
    }
  }

  &__item-products {
    list-style: none;
    margin-bottom: 0.5rem;

    li {
      padding: 0.15rem 0;
    }
  }

  &__item-total {
    font-weight: 700;
    text-align: right;
  }
}
```

- [ ] **Step 4: Add the route**

In `src/app/app.routes.ts`, add right after the `checkout/confirmacion/:id` route from Task 3:

```ts
  {
    path: 'pedidos',
    loadComponent: () => import('./pages/orders/orders').then(m => m.OrdersComponent),
    canActivate: [authGuard],
  },
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx ng test --watch=false`
Expected: PASS — all `OrdersComponent` tests green.

- [ ] **Step 6: Commit**

```bash
git add src/app/pages/orders/orders.ts src/app/pages/orders/orders.html src/app/pages/orders/orders.scss src/app/pages/orders/orders.spec.ts src/app/app.routes.ts
git commit -m "feat(orders): add \"Mis pedidos\" order history page"
```

---

### Task 5: Wire the navbar's "Hacer pedido" button to `/checkout`

**Context:** `src/app/shared/components/navbar/navbar.html:73` already has a `<button class="btn-primary">Hacer pedido ✨</button>` inside the cart panel footer, with no handler. That footer only renders when the cart has items (`@else` branch of `@if (cart.itemCount() === 0)` at `navbar.html:50`), so no extra "disabled when empty" logic is needed — the button is already unreachable while the cart is empty.

**Also fixes:** `navbar.spec.ts` currently fails (`NG0201: No provider found for Auth`) because `NavbarComponent` injects the real `AuthService`/`CartService` without overriding them in the test. This task fixes that as part of adding real test coverage for the button.

**Files:**
- Modify: `src/app/shared/components/navbar/navbar.html`
- Modify: `src/app/shared/components/navbar/navbar.spec.ts`

**Interfaces:**
- Consumes: `CartService` (existing), `AuthService` (existing) — no new methods.

- [ ] **Step 1: Write the failing test**

Replace the full contents of `src/app/shared/components/navbar/navbar.spec.ts` with:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { provideRouter } from '@angular/router';
import { NavbarComponent } from './navbar';
import { AuthService } from '../../../core/services/auth.service';
import { CartService } from '../../../core/services/cart.service';
import type { CartItem } from '../../../core/services/cart.service';
import type { Product } from '../../../core/models/product.model';

const SAMPLE_PRODUCT: Product = {
  id: 'p1',
  name: 'Mochi de Fresa',
  price: 3.5,
  description: 'Tierno mochi relleno de anko y fresas frescas.',
  emoji: '🍓',
  category: 'mochi',
};

class FakeAuthService {
  currentUser = signal<{ uid: string } | undefined>({ uid: 'user-1' });
  isLoggedIn = computed(() => !!this.currentUser());
  logout = vi.fn();
}

class FakeCartService {
  private itemsSignal = signal<CartItem[]>([]);
  itemCount = computed(() => this.itemsSignal().reduce((sum, i) => sum + i.quantity, 0));
  total = computed(() => this.itemsSignal().reduce((sum, i) => sum + i.product.price * i.quantity, 0));
  getItems() {
    return this.itemsSignal.asReadonly();
  }
  setItems(items: CartItem[]) {
    this.itemsSignal.set(items);
  }
  add = vi.fn();
  remove = vi.fn();
  removeAll = vi.fn();
}

describe('Navbar', () => {
  let component: NavbarComponent;
  let fixture: ComponentFixture<NavbarComponent>;
  let cart: FakeCartService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NavbarComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useClass: FakeAuthService },
        { provide: CartService, useClass: FakeCartService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NavbarComponent);
    component = fixture.componentInstance;
    cart = TestBed.inject(CartService) as unknown as FakeCartService;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('clicking "Hacer pedido" closes the cart panel', () => {
    cart.setItems([{ product: SAMPLE_PRODUCT, quantity: 1 }]);
    component.cartOpen.set(true);
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.cart-panel__footer button');
    button.click();

    expect(component.cartOpen()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx ng test --watch=false`
Expected: FAIL on `'clicking "Hacer pedido" closes the cart panel'` — clicking the button does nothing yet (`toggleCart()` isn't wired to it), so `cartOpen()` stays `true`. (The pre-existing `NG0201` failure on `'should create'` is now gone thanks to the DI fixes above.)

- [ ] **Step 3: Wire the button**

In `src/app/shared/components/navbar/navbar.html`, replace:

```html
    <button class="btn-primary">Hacer pedido ✨</button>
```

with:

```html
    <button class="btn-primary" [routerLink]="'/checkout'" (click)="toggleCart()">Hacer pedido ✨</button>
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx ng test --watch=false`
Expected: PASS — both `Navbar` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/app/shared/components/navbar/navbar.html src/app/shared/components/navbar/navbar.spec.ts
git commit -m "fix(navbar): wire \"Hacer pedido\" button to /checkout"
```

---

### Task 6: Admin "Pedidos" tab

**Files:**
- Modify: `src/app/pages/admin/admin.ts`
- Modify: `src/app/pages/admin/admin.html`
- Modify: `src/app/pages/admin/admin.scss`
- Modify: `src/app/pages/admin/admin.spec.ts`

**Interfaces:**
- Consumes: `OrderService.watchAll()`, `OrderService.updateStatus(id, status)` (Task 1).
- Produces: `AdminComponent.activeTab: Signal<'productos' | 'pedidos'>`, `AdminComponent.orders: Signal<Order[]>`, `AdminComponent.changeStatus(order: Order, status: OrderStatus): Promise<void>`.

- [ ] **Step 1: Write the failing test**

In `src/app/pages/admin/admin.spec.ts`, add these imports at the top (alongside the existing ones):

```ts
import { of } from 'rxjs';
import { OrderService } from '../../core/services/order.service';
import type { Order, OrderStatus } from '../../core/models/order.model';
```

Add this Fake class and sample order near `FakeProductService`:

```ts
class FakeOrderService {
  watchAll = vi.fn().mockReturnValue(of([]));
  updateStatus = vi.fn().mockResolvedValue(undefined);
}

const SAMPLE_ORDER: Order = {
  id: 'order-1',
  userId: 'user-1',
  items: [{ productId: '1', name: 'Mochi de Fresa', price: 3.5, quantity: 2 }],
  total: 7,
  pickupName: 'Ana',
  pickupPhone: '600111222',
  pickupTime: 'Hoy 18:00',
  status: 'pendiente',
  createdAt: 1700000000000,
};
```

Add `OrderService` to the `beforeEach` providers list and capture it, so the block reads:

```ts
  let orderService: FakeOrderService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminComponent],
      providers: [
        { provide: ProductService, useClass: FakeProductService },
        { provide: OrderService, useClass: FakeOrderService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminComponent);
    component = fixture.componentInstance;
    productService = TestBed.inject(ProductService) as unknown as FakeProductService;
    orderService = TestBed.inject(OrderService) as unknown as FakeOrderService;
    await fixture.whenStable();
  });
```

Add these tests at the end of the `describe('AdminComponent', ...)` block, before its closing `});`:

```ts
  it('defaults to the "productos" tab', () => {
    expect(component.activeTab()).toBe('productos');
  });

  it('exposes orders from OrderService.watchAll()', () => {
    expect(component.orders()).toEqual([]);
  });

  it('changeStatus() calls orderService.updateStatus with the new status', async () => {
    await component.changeStatus(SAMPLE_ORDER, 'listo' as OrderStatus);
    expect(orderService.updateStatus).toHaveBeenCalledWith('order-1', 'listo');
  });

  it('changeStatus() surfaces an error when the update fails', async () => {
    orderService.updateStatus.mockRejectedValue(new Error('offline'));
    await component.changeStatus(SAMPLE_ORDER, 'listo' as OrderStatus);
    expect(component.orderError()).toContain('offline');
  });
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx ng test --watch=false`
Expected: FAIL — `component.activeTab is not a function` (doesn't exist yet).

- [ ] **Step 3: Implement the tab in `AdminComponent`**

In `src/app/pages/admin/admin.ts`, update the imports at the top to:

```ts
import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ProductService } from '../../core/services/product.service';
import { OrderService } from '../../core/services/order.service';
import { Product } from '../../core/models/product.model';
import type { Order, OrderStatus } from '../../core/models/order.model';
```

Add `DatePipe` to the component's `imports` array (`imports: [ReactiveFormsModule, CurrencyPipe, DatePipe]`).

Add these members to `AdminComponent`, right after `productService = inject(ProductService);`:

```ts
  orderService = inject(OrderService);

  activeTab = signal<'productos' | 'pedidos'>('productos');
  orders = toSignal(this.orderService.watchAll(), { initialValue: [] as Order[] });
  orderError = signal('');
  readonly orderStatuses: OrderStatus[] = ['pendiente', 'listo', 'entregado'];
```

Add this method at the end of the class, before the closing `}`:

```ts
  async changeStatus(order: Order, status: OrderStatus): Promise<void> {
    this.orderError.set('');
    try {
      await this.orderService.updateStatus(order.id, status);
    } catch (e: any) {
      this.orderError.set('❌ ' + (e.message ?? 'Error al actualizar el pedido'));
    }
  }
```

- [ ] **Step 4: Update the template**

Replace the full contents of `src/app/pages/admin/admin.html` with:

```html
<section class="admin">
  <div class="admin__header">
    <h1>Panel de administración</h1>
    <p>Gestión de productos y pedidos</p>
  </div>

  <div class="admin__tabs">
    <button type="button" class="admin__tab" [class.admin__tab--active]="activeTab() === 'productos'"
      (click)="activeTab.set('productos')">Productos</button>
    <button type="button" class="admin__tab" [class.admin__tab--active]="activeTab() === 'pedidos'"
      (click)="activeTab.set('pedidos')">Pedidos</button>
  </div>

  @if (activeTab() === 'productos') {
  @if (error()) {
  <p class="admin__error">{{ error() }}</p>
  }

  @if (productService.products().length === 0) {
  <div class="admin__seed">
    <p>No hay productos todavía.</p>
    <button type="button" class="btn-primary" [disabled]="saving()" (click)="seed()">Cargar productos de ejemplo</button>
  </div>
  }

  <form class="admin__form" [formGroup]="form" (ngSubmit)="submit()">
    <div class="admin__field">
      <label for="name">Nombre</label>
      <input id="name" type="text" formControlName="name" />
    </div>

    <div class="admin__field">
      <label for="price">Precio (€)</label>
      <input id="price" type="number" step="0.1" formControlName="price" />
    </div>

    <div class="admin__field admin__field--full">
      <label for="emoji">Emoji</label>
      <input id="emoji" type="text" formControlName="emoji" />
      <div class="admin__emoji-picker">
        @for (emoji of emojiOptions; track emoji) {
        <button type="button" class="admin__emoji-option" (click)="pickEmoji(emoji)">{{ emoji }}</button>
        }
      </div>
    </div>

    <div class="admin__field">
      <label for="category">Categoría</label>
      <select id="category" formControlName="category">
        @for (cat of categories; track cat) {
        <option [value]="cat">{{ cat }}</option>
        }
      </select>
    </div>

    <div class="admin__field admin__field--checkbox">
      <label>
        <input type="checkbox" formControlName="isNew" />
        Marcar como nuevo
      </label>
    </div>

    <div class="admin__field admin__field--full">
      <label for="description">Descripción</label>
      <textarea id="description" formControlName="description"></textarea>
    </div>

    <div class="admin__actions">
      <button type="submit" class="btn-primary" [disabled]="form.invalid || saving()">
        {{ editingId() ? 'Guardar cambios' : 'Añadir producto' }}
      </button>
      @if (editingId()) {
      <button type="button" class="admin__cancel" (click)="cancelEdit()">Cancelar</button>
      }
    </div>
  </form>

  <table class="admin__table">
    <thead>
      <tr>
        <th>Producto</th>
        <th>Categoría</th>
        <th>Precio</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      @for (product of productService.products(); track product.id) {
      <tr>
        <td>{{ product.emoji }} {{ product.name }}</td>
        <td>{{ product.category }}</td>
        <td>{{ product.price | currency:'EUR' }}</td>
        <td class="admin__row-actions">
          <button type="button" (click)="startEdit(product)">✏️</button>
          <button type="button" (click)="remove(product)">🗑️</button>
        </td>
      </tr>
      }
    </tbody>
  </table>
  }

  @if (activeTab() === 'pedidos') {
  @if (orderError()) {
  <p class="admin__error">{{ orderError() }}</p>
  }

  @if (orders().length === 0) {
  <p class="admin__empty">Todavía no hay pedidos.</p>
  } @else {
  <table class="admin__table">
    <thead>
      <tr>
        <th>Fecha</th>
        <th>Cliente</th>
        <th>Pedido</th>
        <th>Total</th>
        <th>Estado</th>
      </tr>
    </thead>
    <tbody>
      @for (order of orders(); track order.id) {
      <tr>
        <td>{{ order.createdAt | date:'d MMM y, HH:mm' }}</td>
        <td>{{ order.pickupName }}<br />{{ order.pickupPhone }}</td>
        <td>
          @for (item of order.items; track item.productId) {
          <div>{{ item.name }} × {{ item.quantity }}</div>
          }
        </td>
        <td>{{ order.total | currency:'EUR' }}</td>
        <td>
          <select [value]="order.status" (change)="changeStatus(order, $any($event.target).value)">
            @for (status of orderStatuses; track status) {
            <option [value]="status">{{ status }}</option>
            }
          </select>
        </td>
      </tr>
      }
    </tbody>
  </table>
  }
  }
</section>
```

- [ ] **Step 5: Add tab styles**

In `src/app/pages/admin/admin.scss`, add these rules inside the `.admin { ... }` block (e.g. right after `&__header { ... }`):

```scss
  &__tabs {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    margin-bottom: 1.5rem;
  }

  &__tab {
    background: transparent;
    border: 1px solid $border;
    border-radius: $radius-xl;
    padding: 0.5rem 1.25rem;
    cursor: pointer;
    font-weight: 600;
    color: $text-muted;

    &--active {
      background: $primary;
      color: $white;
      border-color: $primary;
    }
  }

  &__empty {
    text-align: center;
    color: $text-muted;
  }
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `npx ng test --watch=false`
Expected: PASS — all `AdminComponent` tests green, including the 4 new ones.

- [ ] **Step 7: Commit**

```bash
git add src/app/pages/admin/admin.ts src/app/pages/admin/admin.html src/app/pages/admin/admin.scss src/app/pages/admin/admin.spec.ts
git commit -m "feat(admin): add Pedidos tab to view and update order status"
```

---

### Task 7: Manual end-to-end verification

**Files:** none (no code changes — this task only verifies Tasks 1–6 work together in the real app).

- [ ] **Step 1: Run the full test suite one last time**

Run: `npx ng test --watch=false`
Expected: PASS — every spec in the project is green (no regressions from Tasks 1–6).

- [ ] **Step 2: Start the dev server**

Run: `npx ng serve`
Expected: compiles with no errors, app served at `http://localhost:4200`.

- [ ] **Step 3: Walk the full purchase flow in the browser**

1. Log in (or use the demo account surfaced on `/auth`).
2. Go to `/menu`, add 2–3 products to the cart.
3. Open the cart panel from the navbar and click "Hacer pedido ✨" — confirm it navigates to `/checkout` and the panel closes.
4. Confirm the checkout page shows the same items/total as the cart.
5. Fill in nombre / teléfono / horario de retiro and submit.
6. Confirm you land on `/checkout/confirmacion/<id>` showing the order details, and that the cart is now empty (badge gone from the navbar).
7. Go to `/pedidos` and confirm the order you just placed appears with status "pendiente".
8. Go to `/admin`, switch to the "Pedidos" tab, confirm the same order appears, and change its status to "listo".
9. Refresh `/pedidos` and confirm the status shown there is now "listo" (proves the Firestore write persisted, not just local state).

- [ ] **Step 4: Report results**

If every step in Step 3 works as described, the feature is complete — no commit needed for this task (it's verification only). If anything fails, treat it as a bug against the specific task that owns the broken behavior and fix it there (re-run that task's test-first cycle) rather than patching around it here.
