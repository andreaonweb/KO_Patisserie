# Frontend API Integration (ko_front) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap `ko_front`'s data layer — `AuthService`, `ProductService`, `OrderService`, `authGuard` — from Firebase Auth/Firestore to `ko_back`'s REST API, with zero visual/UX change to the app.

**Architecture:** A functional `HttpInterceptorFn` attaches the JWT to every API request and handles 401s globally. `AuthService` stores the JWT in `localStorage` and exposes a `currentUser` signal populated from `GET /auth/me`. `ProductService`/`OrderService` call the REST endpoints from sub-project 3 and translate snake_case API fields to the app's existing camelCase models at the service boundary — no template or model-consumer changes beyond the id type becoming `number`.

**Tech Stack:** Angular 21 (standalone components, signals), `HttpClient`, Vitest (`@angular/build:unit-test`), `HttpTestingController` for HTTP-backed service tests.

**Spec:** `docs/superpowers/specs/2026-09-17-frontend-api-integration-design.md`

## Global Constraints

- No visual/UX change anywhere in this plan — same routes, same forms, same markup. Every task's diff should be service/model/config internals plus the minimum consumer-side signature updates needed to keep compiling.
- TypeScript models and every component/template stay camelCase (`isNew`, `pickupName`, `userId`, `productId`). Only `AuthService`/`ProductService`/`OrderService` internals know the API is snake_case.
- `Product.id`, `Order.id`, `Order.userId`, `OrderItem.productId` are `number`, not `string`.
- JWT stored in `localStorage` under the key `shirayuki_token` (see `token-storage.ts` in Task 1).
- No comments in code beyond what's already the project's practice (there is none currently — keep it that way). Fully type-annotated. No new abstraction layer beyond the interceptor and the per-service `fromApi`/`toApiBody`-style mapping functions.
- All commands below run from inside `ko_front/`. The test command is `npm test` (wraps `ng test`, powered by `@angular/build:unit-test`/Vitest). It does not accept a `--run` flag — bare `npm test` runs once and exits (confirmed: this project is not in watch mode by default).

### Documented pre-existing test baseline (read before running any tests)

Running `npm test` on `dev`'s tip **before this plan's Task 1** gives:
**51 tests, 46 passed, 5 failed, across 14 files (4 files with failures).**

The 5 pre-existing failures, and what happens to each over the course of this plan:

1. `src/app/pages/auth/auth.spec.ts` › `should create` — `NG0201: No provider found for Auth` (Firebase). **Fixed by Task 2** (AuthService no longer needs Firebase's `Auth` token; the task adds the HTTP-testing providers this test needs instead).
2. `src/app/app.spec.ts` › `should create the app` — same `NG0201: No provider found for Auth`, via `App` → `NavbarComponent` → `AuthService`. **Fixed by Task 2** (same reason; the task also adds `provideRouter([])` since `App`'s template has a `<router-outlet>` that a bare `TestBed.configureTestingModule` doesn't otherwise satisfy).
3. `src/app/app.spec.ts` › `should render title` — asserts the page contains the text "Hello, DEL_signal_test", which is unrelated Angular-CLI-scaffold boilerplate that has never matched this app's real content (`app.html` renders `<app-navbar>` + `<router-outlet>`, no such heading exists). **Not fixed by this plan** — it's a pre-existing, unrelated content-assertion bug, out of scope. It will keep failing after Task 2, just with a *different* underlying reason (a real assertion mismatch instead of a DI crash) — that's expected and correct, not a regression to chase.
4. `src/app/pages/home/home.spec.ts` › `should create` — `NG0201: No provider found for ActivatedRoute`. **Not fixed by this plan** — `HomeComponent` isn't touched by any task here (it doesn't reference `AuthService`/`ProductService`/`OrderService`), so this stays exactly as broken as it is today.
5. `src/app/shared/components/product-card/product-card.spec.ts` › `should create` — `NG0950: Input "product" is required but no value is available yet`. **Not fixed by this plan** — same reasoning, `ProductCardComponent` isn't touched by any task here.

**Rule for every "run full suite" step below:** compare against this baseline. The only acceptable failures at any point in this plan are #3, #4, and #5 above (once Task 2 lands) or all 5 (before Task 2 lands) — anything else failing is a real regression from this plan's own changes and must be fixed before moving on. Do not attempt to fix #3, #4, or #5 as part of this plan — they are out of scope.

## Execution Workflow

Same per-task-branch pattern as sub-projects 2 and 3: each task gets its
own branch off the current tip of `dev` (`feat/frontend-api-<slug>`),
merged into `dev` as soon as that task's review is clean, branch
deleted, next task branches from the updated `dev`.

---

### Task 1: HTTP client, environment config, token storage, auth interceptor

**Files:**
- Modify: `ko_front/src/app/app.config.ts`
- Modify: `ko_front/src/environments/environment.ts`
- Modify: `ko_front/src/environments/environment.example.ts`
- Create: `ko_front/src/app/core/services/token-storage.ts`
- Create: `ko_front/src/app/core/interceptors/auth.interceptor.ts`
- Create: `ko_front/src/app/core/interceptors/auth.interceptor.spec.ts`

**Interfaces:**
- Produces: `getToken(): string | null`, `setToken(token: string): void`, `clearToken(): void` (`token-storage.ts`) — consumed by Task 2's `AuthService` and by `auth.interceptor.ts` in this task. `authInterceptor: HttpInterceptorFn` — wired into `app.config.ts`'s `provideHttpClient` here, never imported elsewhere. `environment.apiUrl: string` — consumed by every service task (2, 3, 4).

- [ ] **Step 1: Write the failing test**

Create `ko_front/src/app/core/interceptors/auth.interceptor.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { environment } from '../../../environments/environment';
import { clearToken, setToken } from '../services/token-storage';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    clearToken();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    httpMock.verify();
    clearToken();
  });

  it('attaches the Authorization header to API requests when a token is stored', () => {
    setToken('abc123');
    http.get(`${environment.apiUrl}/products`).subscribe();
    const req = httpMock.expectOne(`${environment.apiUrl}/products`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer abc123');
  });

  it('does not attach an Authorization header when no token is stored', () => {
    http.get(`${environment.apiUrl}/products`).subscribe();
    const req = httpMock.expectOne(`${environment.apiUrl}/products`);
    expect(req.request.headers.has('Authorization')).toBe(false);
  });

  it('does not attach an Authorization header to requests outside the API base URL', () => {
    setToken('abc123');
    http.get('https://api.tmb.cat/v1/itransit/bus/parades/123').subscribe();
    const req = httpMock.expectOne('https://api.tmb.cat/v1/itransit/bus/parades/123');
    expect(req.request.headers.has('Authorization')).toBe(false);
  });

  it('clears the stored token and navigates to /auth on a 401 response', () => {
    setToken('abc123');
    const navigateSpy = vi.spyOn(router, 'navigate');
    http.get(`${environment.apiUrl}/orders`).subscribe({ error: () => {} });
    const req = httpMock.expectOne(`${environment.apiUrl}/orders`);
    req.flush({ detail: 'Token inválido' }, { status: 401, statusText: 'Unauthorized' });
    expect(navigateSpy).toHaveBeenCalledWith(['/auth']);
    expect(getTokenForTest()).toBeNull();
  });

  function getTokenForTest(): string | null {
    return localStorage.getItem('shirayuki_token');
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL to compile/collect — `Cannot find module './auth.interceptor'` (and `'../services/token-storage'`), on top of the 5 documented pre-existing failures.

- [ ] **Step 3: Create the token storage helper**

Create `ko_front/src/app/core/services/token-storage.ts`:

```typescript
const TOKEN_KEY = 'shirayuki_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}
```

- [ ] **Step 4: Create the interceptor**

Create `ko_front/src/app/core/interceptors/auth.interceptor.ts`:

```typescript
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { clearToken, getToken } from '../services/token-storage';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);

  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }

  const token = getToken();
  const authReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authReq).pipe(
    catchError(error => {
      if (error.status === 401) {
        clearToken();
        router.navigate(['/auth']);
      }
      return throwError(() => error);
    })
  );
};
```

- [ ] **Step 5: Update `environment.ts` and `environment.example.ts`**

Replace the full contents of `ko_front/src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:8000',
  tmb: {
    appId:  'bc967874',
    appKey: '8cd9f02ba4ad77582803c54c92f3fb31',
  }
};
```

Replace the full contents of `ko_front/src/environments/environment.example.ts`:

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:8000',
  tmb: {
    appId:  'TU_TMB_APP_ID',
    appKey: 'TU_TMB_APP_KEY',
  }
};
```

- [ ] **Step 6: Wire the interceptor into `app.config.ts`**

Replace the full contents of `ko_front/src/app/app.config.ts`:

```typescript
import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test`
Expected: the 4 new interceptor tests pass. Total failures: still exactly the 5 documented pre-existing ones (nothing here touches `AuthService`, `ProductService`, or `OrderService` yet, and `app.config.ts` dropping the Firebase providers does not change `auth.spec.ts`'s or `app.spec.ts`'s failure mode, since those components still construct the *old*, still-Firebase-based `AuthService` until Task 2 lands — they were already failing on the missing `Auth` provider before this task and remain so). Total test count: 51 + 4 = 55.

- [ ] **Step 8: Commit**

```bash
git add src/app/app.config.ts src/environments/environment.ts src/environments/environment.example.ts src/app/core/services/token-storage.ts src/app/core/interceptors
git commit -m "feat(frontend): add HTTP client, API base URL, and auth interceptor"
```

---

### Task 2: Auth — model, service, guard

**Files:**
- Modify: `ko_front/src/app/core/models/user.model.ts`
- Modify: `ko_front/src/app/core/services/auth.service.ts`
- Modify: `ko_front/src/app/core/guards/auth.guard.ts`
- Create: `ko_front/src/app/core/services/auth.service.spec.ts`
- Modify: `ko_front/src/app/pages/auth/auth.spec.ts`
- Modify: `ko_front/src/app/app.spec.ts`
- Modify: `ko_front/src/app/shared/components/navbar/navbar.spec.ts`

**Interfaces:**
- Consumes: `getToken`/`setToken`/`clearToken`, `environment.apiUrl` (Task 1).
- Produces: `AppUser {id: number; email: string; role: 'admin' | 'customer'}`. `AuthService.currentUser: Signal<AppUser | undefined>`, `.isLoggedIn: Signal<boolean>`, `.login(email, password): Promise<void>`, `.register(email, password): Promise<void>`, `.logout(): Promise<void>` — same method names/arity as before, consumed unchanged by `pages/auth/auth.ts` and `shared/components/navbar/navbar.ts` (neither file needs to change). `authGuard: CanActivateFn` — same export name, consumed unchanged by `app.routes.ts`.

- [ ] **Step 1: Write the failing tests**

Create `ko_front/src/app/core/services/auth.service.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';
import { clearToken, getToken } from './token-storage';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    clearToken();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    service = TestBed.inject(AuthService);
  });

  afterEach(() => {
    httpMock.verify();
    clearToken();
  });

  it('is not logged in with no stored token', () => {
    expect(service.isLoggedIn()).toBe(false);
  });

  it('login() stores the token, loads the current user, and navigates home', async () => {
    const navigateSpy = vi.spyOn(router, 'navigate');
    const loginPromise = service.login('ana@test.com', 'secret123');

    const loginReq = httpMock.expectOne(`${environment.apiUrl}/auth/login`);
    expect(loginReq.request.body).toEqual({ email: 'ana@test.com', password: 'secret123' });
    loginReq.flush({ access_token: 'abc123', token_type: 'bearer' });

    const meReq = httpMock.expectOne(`${environment.apiUrl}/auth/me`);
    meReq.flush({ id: 1, email: 'ana@test.com', role: 'customer' });

    await loginPromise;

    expect(getToken()).toBe('abc123');
    expect(service.currentUser()).toEqual({ id: 1, email: 'ana@test.com', role: 'customer' });
    expect(service.isLoggedIn()).toBe(true);
    expect(navigateSpy).toHaveBeenCalledWith(['/home']);
  });

  it('register() stores the token, loads the current user, and navigates home', async () => {
    const registerPromise = service.register('ana@test.com', 'secret123');

    const registerReq = httpMock.expectOne(`${environment.apiUrl}/auth/register`);
    expect(registerReq.request.body).toEqual({ email: 'ana@test.com', password: 'secret123' });
    registerReq.flush({ access_token: 'abc123', token_type: 'bearer' });

    const meReq = httpMock.expectOne(`${environment.apiUrl}/auth/me`);
    meReq.flush({ id: 1, email: 'ana@test.com', role: 'customer' });

    await registerPromise;

    expect(service.isLoggedIn()).toBe(true);
  });

  it('logout() clears the token and current user, and navigates to /auth', async () => {
    const navigateSpy = vi.spyOn(router, 'navigate');

    await service.logout();

    expect(getToken()).toBeNull();
    expect(service.currentUser()).toBeUndefined();
    expect(navigateSpy).toHaveBeenCalledWith(['/auth']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `auth.service.spec.ts` errors (`AuthService` still constructs the Firebase `Auth` token, which has no provider in this spec's `TestBed`).

- [ ] **Step 3: Update the user model**

Replace the full contents of `ko_front/src/app/core/models/user.model.ts`:

```typescript
export interface AppUser {
  id: number;
  email: string;
  role: 'admin' | 'customer';
}
```

- [ ] **Step 4: Rewrite `AuthService`**

Replace the full contents of `ko_front/src/app/core/services/auth.service.ts`:

```typescript
import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AppUser } from '../models/user.model';
import { clearToken, getToken, setToken } from './token-storage';

interface TokenResponse {
  access_token: string;
  token_type: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  currentUser = signal<AppUser | undefined>(undefined);
  isLoggedIn = computed(() => !!this.currentUser());

  constructor() {
    if (getToken()) {
      this.loadCurrentUser().catch(() => clearToken());
    }
  }

  async login(email: string, password: string): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<TokenResponse>(`${environment.apiUrl}/auth/login`, { email, password })
    );
    setToken(response.access_token);
    await this.loadCurrentUser();
    this.router.navigate(['/home']);
  }

  async register(email: string, password: string): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<TokenResponse>(`${environment.apiUrl}/auth/register`, { email, password })
    );
    setToken(response.access_token);
    await this.loadCurrentUser();
    this.router.navigate(['/home']);
  }

  async logout(): Promise<void> {
    clearToken();
    this.currentUser.set(undefined);
    this.router.navigate(['/auth']);
  }

  private async loadCurrentUser(): Promise<void> {
    const user = await firstValueFrom(this.http.get<AppUser>(`${environment.apiUrl}/auth/me`));
    this.currentUser.set(user);
  }
}
```

- [ ] **Step 5: Rewrite `authGuard`**

Replace the full contents of `ko_front/src/app/core/guards/auth.guard.ts`:

```typescript
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isLoggedIn()) return true;
  router.navigate(['/auth']);
  return false;
};
```

- [ ] **Step 6: Fix `auth.spec.ts`'s missing providers**

Replace the full contents of `ko_front/src/app/pages/auth/auth.spec.ts`:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { AuthComponent } from './auth';

describe('Auth', () => {
  let component: AuthComponent;
  let fixture: ComponentFixture<AuthComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuthComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(AuthComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
```

- [ ] **Step 7: Fix `app.spec.ts`'s missing providers**

In `ko_front/src/app/app.spec.ts`, replace:

```typescript
import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });
```

with:

```typescript
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
  });
```

Leave the rest of the file (both `it(...)` blocks) untouched — `should render title` will still fail, for the unrelated, documented, out-of-scope reason (see Global Constraints).

- [ ] **Step 8: Fix `navbar.spec.ts`'s `FakeAuthService` shape**

In `ko_front/src/app/shared/components/navbar/navbar.spec.ts`, replace:

```typescript
class FakeAuthService {
  currentUser = signal<{ uid: string } | undefined>({ uid: 'user-1' });
  isLoggedIn = computed(() => !!this.currentUser());
  logout = vi.fn();
}
```

with:

```typescript
class FakeAuthService {
  currentUser = signal<{ id: number; role: string } | undefined>({ id: 1, role: 'customer' });
  isLoggedIn = computed(() => !!this.currentUser());
  logout = vi.fn();
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test`
Expected: `auth.service.spec.ts` (4 new tests) passes; `auth.spec.ts`'s `should create` now passes; `app.spec.ts`'s `should create the app` now passes; `navbar.spec.ts` (2 tests, unchanged assertions) still passes. Remaining failures: exactly 3 — `app.spec.ts`'s `should render title`, `home.spec.ts`'s `should create`, `product-card.spec.ts`'s `should create` (all documented, out of scope). Total test count: 55 + 4 = 59, failed: 3.

- [ ] **Step 10: Commit**

```bash
git add src/app/core/models/user.model.ts src/app/core/services/auth.service.ts src/app/core/services/auth.service.spec.ts src/app/core/guards/auth.guard.ts src/app/pages/auth/auth.spec.ts src/app/app.spec.ts src/app/shared/components/navbar/navbar.spec.ts
git commit -m "feat(frontend): swap AuthService and authGuard from Firebase Auth to the API"
```

---

### Task 3: Product — model, service, admin product UI cleanup

**Files:**
- Modify: `ko_front/src/app/core/models/product.model.ts`
- Modify: `ko_front/src/app/core/services/product.service.ts`
- Modify: `ko_front/src/app/pages/admin/admin.ts`
- Modify: `ko_front/src/app/pages/admin/admin.html`
- Modify: `ko_front/src/app/core/services/product.service.spec.ts`
- Modify: `ko_front/src/app/pages/admin/admin.spec.ts`
- Modify: `ko_front/src/app/shared/components/navbar/navbar.spec.ts`

**Interfaces:**
- Consumes: `environment.apiUrl` (Task 1).
- Produces: `Product {id: number; name; price; description; emoji; category; isNew?}`. `ProductService.products: Signal<Product[]>`, `.create(product): Promise<void>`, `.update(id: number, changes): Promise<void>`, `.remove(id: number): Promise<void>` — same names as before minus `seedIfEmpty` (removed), consumed unchanged by `pages/menu/menu.ts` and `shared/components/product-card/product-card.ts` (neither needs to change).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `ko_front/src/app/core/services/product.service.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ProductService } from './product.service';
import { environment } from '../../../environments/environment';

const API_PRODUCT = {
  id: 1,
  name: 'Mochi de Fresa',
  price: 3.5,
  description: 'Tierno mochi relleno de anko y fresas frescas.',
  emoji: '🍓',
  category: 'mochi' as const,
  is_new: false,
  created_at: '2026-01-01T00:00:00',
};

function createService(initialRows: unknown[] = []): { service: ProductService; httpMock: HttpTestingController } {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const service = TestBed.inject(ProductService);
  const httpMock = TestBed.inject(HttpTestingController);
  httpMock.expectOne(`${environment.apiUrl}/products`).flush(initialRows);
  return { service, httpMock };
}

describe('ProductService', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('should create', () => {
    const { service } = createService();
    expect(service).toBeTruthy();
  });

  it('exposes an empty products signal when the API returns none', () => {
    const { service } = createService();
    expect(service.products()).toEqual([]);
  });

  it('loads products from the API and maps is_new to isNew', () => {
    const { service } = createService([API_PRODUCT]);
    expect(service.products()).toEqual([
      {
        id: 1,
        name: 'Mochi de Fresa',
        price: 3.5,
        description: 'Tierno mochi relleno de anko y fresas frescas.',
        emoji: '🍓',
        category: 'mochi',
        isNew: false,
      },
    ]);
  });

  it('create() posts the mapped product and reloads the list', async () => {
    const { service, httpMock } = createService();
    const createPromise = service.create({
      name: 'Mochi de Fresa',
      price: 3.5,
      description: 'Tierno mochi relleno de anko y fresas frescas.',
      emoji: '🍓',
      category: 'mochi',
      isNew: true,
    });

    const postReq = httpMock.expectOne(`${environment.apiUrl}/products`);
    expect(postReq.request.method).toBe('POST');
    expect(postReq.request.body).toEqual({
      name: 'Mochi de Fresa',
      price: 3.5,
      description: 'Tierno mochi relleno de anko y fresas frescas.',
      emoji: '🍓',
      category: 'mochi',
      is_new: true,
    });
    postReq.flush({ ...API_PRODUCT, is_new: true });

    httpMock.expectOne(`${environment.apiUrl}/products`).flush([{ ...API_PRODUCT, is_new: true }]);
    await createPromise;

    expect(service.products()[0].isNew).toBe(true);
  });

  it('update() puts the mapped changes to the product id and reloads the list', async () => {
    const { service, httpMock } = createService();
    const updatePromise = service.update(1, {
      name: 'Mochi Actualizado',
      price: 4.0,
      description: 'd',
      emoji: '🍓',
      category: 'mochi',
      isNew: false,
    });

    const putReq = httpMock.expectOne(`${environment.apiUrl}/products/1`);
    expect(putReq.request.method).toBe('PUT');
    expect(putReq.request.body).toEqual({
      name: 'Mochi Actualizado',
      price: 4.0,
      description: 'd',
      emoji: '🍓',
      category: 'mochi',
      is_new: false,
    });
    putReq.flush({ ...API_PRODUCT, name: 'Mochi Actualizado', price: 4.0 });

    httpMock.expectOne(`${environment.apiUrl}/products`).flush([]);
    await updatePromise;
  });

  it('remove() deletes the product by id and reloads the list', async () => {
    const { service, httpMock } = createService();
    const removePromise = service.remove(1);

    const deleteReq = httpMock.expectOne(`${environment.apiUrl}/products/1`);
    expect(deleteReq.request.method).toBe('DELETE');
    deleteReq.flush(null);

    httpMock.expectOne(`${environment.apiUrl}/products`).flush([]);
    await removePromise;
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `product.service.spec.ts` errors (`ProductService` still constructs the Firestore `Firestore` token, which has no provider in this spec's `TestBed`).

- [ ] **Step 3: Update the product model**

Replace the full contents of `ko_front/src/app/core/models/product.model.ts`:

```typescript
export interface Product {
  id: number;
  name: string;
  price: number;
  description: string;
  emoji: string;
  category: 'mochi' | 'donut' | 'cake' | 'drink';
  isNew?: boolean;
}
```

- [ ] **Step 4: Rewrite `ProductService`**

Replace the full contents of `ko_front/src/app/core/services/product.service.ts`:

```typescript
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Product } from '../models/product.model';

interface ProductApiResponse {
  id: number;
  name: string;
  price: number;
  description: string;
  emoji: string;
  category: Product['category'];
  is_new: boolean;
  created_at: string;
}

const BASE = `${environment.apiUrl}/products`;

@Injectable({ providedIn: 'root' })
export class ProductService {
  private http = inject(HttpClient);

  products = signal<Product[]>([]);

  constructor() {
    void this.load();
  }

  async create(product: Omit<Product, 'id'>): Promise<void> {
    await firstValueFrom(this.http.post<ProductApiResponse>(BASE, toApiBody(product)));
    await this.load();
  }

  async update(id: number, changes: Omit<Product, 'id'>): Promise<void> {
    await firstValueFrom(this.http.put<ProductApiResponse>(`${BASE}/${id}`, toApiBody(changes)));
    await this.load();
  }

  async remove(id: number): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`${BASE}/${id}`));
    await this.load();
  }

  private async load(): Promise<void> {
    const rows = await firstValueFrom(this.http.get<ProductApiResponse[]>(BASE));
    this.products.set(rows.map(fromApi));
  }
}

function fromApi(row: ProductApiResponse): Product {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    description: row.description,
    emoji: row.emoji,
    category: row.category,
    isNew: row.is_new,
  };
}

function toApiBody(product: Omit<Product, 'id'>): Record<string, unknown> {
  return {
    name: product.name,
    price: product.price,
    description: product.description,
    emoji: product.emoji,
    category: product.category,
    is_new: product.isNew ?? false,
  };
}
```

- [ ] **Step 5: Remove the "seed sample products" feature from `admin.ts`**

In `ko_front/src/app/pages/admin/admin.ts`, delete the `SAMPLE_PRODUCTS` constant (the block starting `const SAMPLE_PRODUCTS: Omit<Product, 'id'>[] = [` through its closing `];`), delete the `seed()` method (the block starting `async seed(): Promise<void> {` through its closing `}`), and change:

```typescript
  editingId = signal<string | null>(null);
```

to:

```typescript
  editingId = signal<number | null>(null);
```

- [ ] **Step 6: Remove the seed button from `admin.html`**

In `ko_front/src/app/pages/admin/admin.html`, replace:

```html
  @if (productService.products().length === 0) {
  <div class="admin__seed">
    <p>No hay productos todavía.</p>
    <button type="button" class="btn-primary" [disabled]="saving()" (click)="seed()">Cargar productos de ejemplo</button>
  </div>
  }
```

with:

```html
  @if (productService.products().length === 0) {
  <p class="admin__seed">No hay productos todavía.</p>
  }
```

- [ ] **Step 7: Update `admin.spec.ts`'s product-related fakes and assertions**

In `ko_front/src/app/pages/admin/admin.spec.ts`, replace:

```typescript
class FakeProductService {
  products = signal<Product[]>([]);
  create = vi.fn().mockResolvedValue(undefined);
  update = vi.fn().mockResolvedValue(undefined);
  remove = vi.fn().mockResolvedValue(undefined);
  seedIfEmpty = vi.fn().mockResolvedValue(undefined);
}
```

with:

```typescript
class FakeProductService {
  products = signal<Product[]>([]);
  create = vi.fn().mockResolvedValue(undefined);
  update = vi.fn().mockResolvedValue(undefined);
  remove = vi.fn().mockResolvedValue(undefined);
}
```

Replace:

```typescript
const SAMPLE_PRODUCT: Product = {
  id: '1',
```

with:

```typescript
const SAMPLE_PRODUCT: Product = {
  id: 1,
```

Replace:

```typescript
    expect(component.editingId()).toBe('1');
```

with:

```typescript
    expect(component.editingId()).toBe(1);
```

Replace:

```typescript
    expect(productService.update).toHaveBeenCalledWith('1', {
```

with:

```typescript
    expect(productService.update).toHaveBeenCalledWith(1, {
```

Replace (both occurrences — the "asks for confirmation" test and the sentence right after it is a different assertion, only this exact line appears once):

```typescript
    expect(productService.remove).toHaveBeenCalledWith('1');
```

with:

```typescript
    expect(productService.remove).toHaveBeenCalledWith(1);
```

Replace:

```typescript
    const productWithoutIsNew: Product = {
      id: '2',
```

with:

```typescript
    const productWithoutIsNew: Product = {
      id: 2,
```

Delete the entire test block:

```typescript
  it('seed() sets saving() while in flight and resets it to false afterwards', async () => {
    let resolveSeed!: () => void;
    productService.seedIfEmpty.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSeed = resolve;
      }),
    );

    const seedPromise = component.seed();
    expect(component.saving()).toBe(true);

    resolveSeed();
    await seedPromise;

    expect(component.saving()).toBe(false);
  });

```

Leave every other line (including the `SAMPLE_ORDER` constant and every order-related test) untouched — those are Task 4's concern.

- [ ] **Step 8: Fix `navbar.spec.ts`'s `SAMPLE_PRODUCT` id**

In `ko_front/src/app/shared/components/navbar/navbar.spec.ts`, replace:

```typescript
const SAMPLE_PRODUCT: Product = {
  id: 'p1',
```

with:

```typescript
const SAMPLE_PRODUCT: Product = {
  id: 1,
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test`
Expected: `product.service.spec.ts` (6 tests, replacing the old file's 7 — net −1, since 2 `seedIfEmpty` tests were dropped and 1 new mapping test was added) passes; `admin.spec.ts`'s product-related tests pass, the deleted `seed()` test is gone (net −1 in that file); `navbar.spec.ts` still passes. Failures: still exactly the 3 documented ones from Task 2. Total test count: 59 − 1 (product.service.spec.ts net) − 1 (admin.spec.ts seed test removed) = 57, failed: 3, passed: 54.

- [ ] **Step 10: Commit**

```bash
git add src/app/core/models/product.model.ts src/app/core/services/product.service.ts src/app/core/services/product.service.spec.ts src/app/pages/admin/admin.ts src/app/pages/admin/admin.html src/app/pages/admin/admin.spec.ts src/app/shared/components/navbar/navbar.spec.ts
git commit -m "feat(frontend): swap ProductService from Firestore to the API, drop sample-product seeding"
```

---

### Task 4: Order — model, service, and every consumer

**Files:**
- Modify: `ko_front/src/app/core/models/order.model.ts`
- Modify: `ko_front/src/app/core/services/order.service.ts`
- Modify: `ko_front/src/app/pages/checkout/checkout.ts`
- Modify: `ko_front/src/app/pages/checkout/confirmation.ts`
- Modify: `ko_front/src/app/pages/orders/orders.ts`
- Modify: `ko_front/src/app/pages/admin/admin.ts`
- Modify: `ko_front/src/app/core/services/order.service.spec.ts`
- Modify: `ko_front/src/app/pages/checkout/checkout.spec.ts`
- Modify: `ko_front/src/app/pages/checkout/confirmation.spec.ts`
- Modify: `ko_front/src/app/pages/orders/orders.spec.ts`
- Modify: `ko_front/src/app/pages/admin/admin.spec.ts`

**Interfaces:**
- Consumes: `environment.apiUrl` (Task 1), `AuthService.currentUser` (Task 2, only to confirm it's no longer needed by any of these consumers — this task removes those reads).
- Produces: `Order {id: number; userId: number; items: OrderItem[]; total; pickupName; pickupPhone; pickupTime; status; createdAt}`, `OrderItem {productId: number; name; price; quantity}`, `CreateOrderInput {items: {productId: number; quantity: number}[]; pickupName; pickupPhone; pickupTime}`. `OrderService.create(order: CreateOrderInput): Promise<number>`, `.getMine(): Observable<Order[]>`, `.getAll(): Observable<Order[]>`, `.getById(id: number): Promise<Order | undefined>`, `.updateStatus(id: number, status: OrderStatus): Promise<void>` (replaces `watchByUser`/`watchAll`/`create`/`getById`/`updateStatus`).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `ko_front/src/app/core/services/order.service.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { OrderService } from './order.service';
import { environment } from '../../../environments/environment';

const API_ORDER = {
  id: 1,
  user_id: 2,
  items: [{ product_id: 1, name: 'Mochi de Fresa', price: 3.5, quantity: 2 }],
  total: 7,
  pickup_name: 'Ana',
  pickup_phone: '600111222',
  pickup_time: 'Hoy 18:00',
  status: 'pendiente' as const,
  created_at: '2026-01-01T00:00:00Z',
};

function createService(): { service: OrderService; httpMock: HttpTestingController } {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    service: TestBed.inject(OrderService),
    httpMock: TestBed.inject(HttpTestingController),
  };
}

describe('OrderService', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('should create', () => {
    const { service } = createService();
    expect(service).toBeTruthy();
  });

  it('create() posts product_id/quantity per item and pickup info, and returns the new id', async () => {
    const { service, httpMock } = createService();
    const createPromise = service.create({
      items: [{ productId: 1, quantity: 2 }],
      pickupName: 'Ana',
      pickupPhone: '600111222',
      pickupTime: 'Hoy 18:00',
    });

    const req = httpMock.expectOne(`${environment.apiUrl}/orders`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      items: [{ product_id: 1, quantity: 2 }],
      pickup_name: 'Ana',
      pickup_phone: '600111222',
      pickup_time: 'Hoy 18:00',
    });
    req.flush(API_ORDER);

    expect(await createPromise).toBe(1);
  });

  it('getMine() GETs /orders and maps each row to the camelCase Order shape', async () => {
    const { service, httpMock } = createService();
    const resultPromise = new Promise(resolve => service.getMine().subscribe(resolve));
    httpMock.expectOne(`${environment.apiUrl}/orders`).flush([API_ORDER]);

    expect(await resultPromise).toEqual([
      {
        id: 1,
        userId: 2,
        items: [{ productId: 1, name: 'Mochi de Fresa', price: 3.5, quantity: 2 }],
        total: 7,
        pickupName: 'Ana',
        pickupPhone: '600111222',
        pickupTime: 'Hoy 18:00',
        status: 'pendiente',
        createdAt: Date.parse('2026-01-01T00:00:00Z'),
      },
    ]);
  });

  it('getAll() GETs /orders and maps each row to the camelCase Order shape', async () => {
    const { service, httpMock } = createService();
    const resultPromise = new Promise(resolve => service.getAll().subscribe(resolve));
    httpMock.expectOne(`${environment.apiUrl}/orders`).flush([API_ORDER]);

    const result = (await resultPromise) as unknown[];
    expect(result.length).toBe(1);
  });

  it('getById() GETs /orders/{id} and returns the mapped order', async () => {
    const { service, httpMock } = createService();
    const getPromise = service.getById(1);
    httpMock.expectOne(`${environment.apiUrl}/orders/1`).flush(API_ORDER);

    const order = await getPromise;
    expect(order?.id).toBe(1);
    expect(order?.userId).toBe(2);
  });

  it('getById() returns undefined when the request fails', async () => {
    const { service, httpMock } = createService();
    const getPromise = service.getById(999);
    httpMock.expectOne(`${environment.apiUrl}/orders/999`).flush(
      { detail: 'Pedido no encontrado' },
      { status: 404, statusText: 'Not Found' }
    );

    expect(await getPromise).toBeUndefined();
  });

  it('updateStatus() PATCHes /orders/{id}/status with the new status', async () => {
    const { service, httpMock } = createService();
    const updatePromise = service.updateStatus(1, 'listo');

    const req = httpMock.expectOne(`${environment.apiUrl}/orders/1/status`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'listo' });
    req.flush({ ...API_ORDER, status: 'listo' });

    await updatePromise;
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `order.service.spec.ts` errors (`OrderService` still constructs the Firestore `Firestore` token).

- [ ] **Step 3: Update the order model**

Replace the full contents of `ko_front/src/app/core/models/order.model.ts`:

```typescript
export type OrderStatus = 'pendiente' | 'listo' | 'entregado';

export interface OrderItem {
  productId: number;
  name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: number;
  userId: number;
  items: OrderItem[];
  total: number;
  pickupName: string;
  pickupPhone: string;
  pickupTime: string;
  status: OrderStatus;
  createdAt: number;
}

export interface CreateOrderInput {
  items: { productId: number; quantity: number }[];
  pickupName: string;
  pickupPhone: string;
  pickupTime: string;
}
```

- [ ] **Step 4: Rewrite `OrderService`**

Replace the full contents of `ko_front/src/app/core/services/order.service.ts`:

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, map, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { CreateOrderInput, Order, OrderItem, OrderStatus } from '../models/order.model';

interface OrderItemApiResponse {
  product_id: number;
  name: string;
  price: number;
  quantity: number;
}

interface OrderApiResponse {
  id: number;
  user_id: number;
  items: OrderItemApiResponse[];
  total: number;
  pickup_name: string;
  pickup_phone: string;
  pickup_time: string;
  status: OrderStatus;
  created_at: string;
}

const BASE = `${environment.apiUrl}/orders`;

@Injectable({ providedIn: 'root' })
export class OrderService {
  private http = inject(HttpClient);

  async create(order: CreateOrderInput): Promise<number> {
    const response = await firstValueFrom(
      this.http.post<OrderApiResponse>(BASE, {
        items: order.items.map(i => ({ product_id: i.productId, quantity: i.quantity })),
        pickup_name: order.pickupName,
        pickup_phone: order.pickupPhone,
        pickup_time: order.pickupTime,
      })
    );
    return response.id;
  }

  getMine(): Observable<Order[]> {
    return this.http.get<OrderApiResponse[]>(BASE).pipe(map(rows => rows.map(fromApi)));
  }

  getAll(): Observable<Order[]> {
    return this.http.get<OrderApiResponse[]>(BASE).pipe(map(rows => rows.map(fromApi)));
  }

  async getById(id: number): Promise<Order | undefined> {
    try {
      const row = await firstValueFrom(this.http.get<OrderApiResponse>(`${BASE}/${id}`));
      return fromApi(row);
    } catch {
      return undefined;
    }
  }

  async updateStatus(id: number, status: OrderStatus): Promise<void> {
    await firstValueFrom(this.http.patch<OrderApiResponse>(`${BASE}/${id}/status`, { status }));
  }
}

function fromApi(row: OrderApiResponse): Order {
  return {
    id: row.id,
    userId: row.user_id,
    items: row.items.map(fromItemApi),
    total: row.total,
    pickupName: row.pickup_name,
    pickupPhone: row.pickup_phone,
    pickupTime: row.pickup_time,
    status: row.status,
    createdAt: Date.parse(row.created_at),
  };
}

function fromItemApi(item: OrderItemApiResponse): OrderItem {
  return {
    productId: item.product_id,
    name: item.name,
    price: item.price,
    quantity: item.quantity,
  };
}
```

- [ ] **Step 5: Rewrite `checkout.ts`**

Replace the full contents of `ko_front/src/app/pages/checkout/checkout.ts`:

```typescript
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import { CartService } from '../../core/services/cart.service';
import { OrderService } from '../../core/services/order.service';

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
    const items = this.cartItems().map(i => ({
      productId: i.product.id,
      quantity: i.quantity,
    }));
    try {
      const orderId = await this.orderService.create({
        items,
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

- [ ] **Step 6: Rewrite `confirmation.ts`**

Replace the full contents of `ko_front/src/app/pages/checkout/confirmation.ts`:

```typescript
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
  error = signal('');

  async ngOnInit(): Promise<void> {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    try {
      this.order.set(await this.orderService.getById(id));
    } catch (e: any) {
      this.error.set('❌ ' + (e.message ?? 'Error al cargar tu pedido'));
    } finally {
      this.loading.set(false);
    }
  }
}
```

- [ ] **Step 7: Rewrite `orders.ts` (page)**

Replace the full contents of `ko_front/src/app/pages/orders/orders.ts`:

```typescript
import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { catchError, of } from 'rxjs';
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
  private orderService = inject(OrderService);

  loadError = signal('');

  orders = toSignal(
    this.orderService.getMine().pipe(
      catchError(e => {
        this.loadError.set('❌ ' + (e.message ?? 'Error al cargar tus pedidos'));
        return of([] as Order[]);
      })
    ),
    { initialValue: [] as Order[] }
  );
}
```

- [ ] **Step 8: Update `admin.ts`'s order-related call**

In `ko_front/src/app/pages/admin/admin.ts`, replace:

```typescript
    this.orderService.watchAll().pipe(
```

with:

```typescript
    this.orderService.getAll().pipe(
```

- [ ] **Step 9: Update `order.service.spec.ts` consumers**

In `ko_front/src/app/pages/checkout/checkout.spec.ts`, replace the full file with:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { CheckoutComponent } from './checkout';
import { CartService } from '../../core/services/cart.service';
import type { CartItem } from '../../core/services/cart.service';
import { OrderService } from '../../core/services/order.service';
import type { Product } from '../../core/models/product.model';

const SAMPLE_PRODUCT: Product = {
  id: 1,
  name: 'Mochi de Fresa',
  price: 3.5,
  description: 'Tierno mochi relleno de anko y fresas frescas.',
  emoji: '🍓',
  category: 'mochi',
};

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
  create = vi.fn().mockResolvedValue(1);
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
      items: [{ productId: 1, quantity: 2 }],
      pickupName: 'Ana',
      pickupPhone: '600111222',
      pickupTime: 'Hoy 18:00',
    });
    expect(cart.clear).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/checkout/confirmacion', 1]);
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

In `ko_front/src/app/pages/checkout/confirmation.spec.ts`, replace the full file with:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { ConfirmationComponent } from './confirmation';
import { OrderService } from '../../core/services/order.service';
import type { Order } from '../../core/models/order.model';

const SAMPLE_ORDER: Order = {
  id: 1,
  userId: 2,
  items: [{ productId: 1, name: 'Mochi de Fresa', price: 3.5, quantity: 2 }],
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
    await setup('1', SAMPLE_ORDER);
    expect(component).toBeTruthy();
  });

  it('starts in a loading state with no order', async () => {
    await setup('1', SAMPLE_ORDER);
    expect(component.loading()).toBe(true);
    expect(component.order()).toBeUndefined();
  });

  it('loads the order by the route id and stops loading', async () => {
    await setup('1', SAMPLE_ORDER);
    await component.ngOnInit();
    expect(getById).toHaveBeenCalledWith(1);
    expect(component.order()).toEqual(SAMPLE_ORDER);
    expect(component.loading()).toBe(false);
  });

  it('leaves order() undefined when no order matches the id', async () => {
    await setup('999', undefined);
    await component.ngOnInit();
    expect(component.order()).toBeUndefined();
    expect(component.loading()).toBe(false);
  });
});
```

In `ko_front/src/app/pages/orders/orders.spec.ts`, replace the full file with:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { OrdersComponent } from './orders';
import { OrderService } from '../../core/services/order.service';
import type { Order } from '../../core/models/order.model';

const SAMPLE_ORDERS: Order[] = [
  {
    id: 1,
    userId: 2,
    items: [{ productId: 1, name: 'Mochi de Fresa', price: 3.5, quantity: 2 }],
    total: 7,
    pickupName: 'Ana',
    pickupPhone: '600111222',
    pickupTime: 'Hoy 18:00',
    status: 'pendiente',
    createdAt: 1700000000000,
  },
];

describe('OrdersComponent', () => {
  let component: OrdersComponent;
  let fixture: ComponentFixture<OrdersComponent>;
  let getMine: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    getMine = vi.fn().mockReturnValue(of(SAMPLE_ORDERS));

    await TestBed.configureTestingModule({
      imports: [OrdersComponent],
      providers: [{ provide: OrderService, useValue: { getMine } }],
    }).compileComponents();

    fixture = TestBed.createComponent(OrdersComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads orders for the current user with no arguments', () => {
    expect(getMine).toHaveBeenCalledWith();
    expect(component.orders()).toEqual(SAMPLE_ORDERS);
  });
});
```

- [ ] **Step 10: Update `admin.spec.ts`'s order-related fakes and assertions**

In `ko_front/src/app/pages/admin/admin.spec.ts`, replace:

```typescript
class FakeOrderService {
  watchAll = vi.fn().mockReturnValue(of([]));
  updateStatus = vi.fn().mockResolvedValue(undefined);
}
```

with:

```typescript
class FakeOrderService {
  getAll = vi.fn().mockReturnValue(of([]));
  updateStatus = vi.fn().mockResolvedValue(undefined);
}
```

Replace:

```typescript
const SAMPLE_ORDER: Order = {
  id: 'order-1',
  userId: 'user-1',
  items: [{ productId: '1', name: 'Mochi de Fresa', price: 3.5, quantity: 2 }],
```

with:

```typescript
const SAMPLE_ORDER: Order = {
  id: 1,
  userId: 2,
  items: [{ productId: 1, name: 'Mochi de Fresa', price: 3.5, quantity: 2 }],
```

Replace:

```typescript
  it('exposes orders from OrderService.watchAll()', () => {
```

with:

```typescript
  it('exposes orders from OrderService.getAll()', () => {
```

Replace:

```typescript
    await component.changeStatus(SAMPLE_ORDER, 'listo' as OrderStatus);
    expect(orderService.updateStatus).toHaveBeenCalledWith('order-1', 'listo');
```

with:

```typescript
    await component.changeStatus(SAMPLE_ORDER, 'listo' as OrderStatus);
    expect(orderService.updateStatus).toHaveBeenCalledWith(1, 'listo');
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `npm test`
Expected: `order.service.spec.ts` (7 tests, replacing the old file's 7 — net 0), `checkout.spec.ts` (7, replacing 7 — net 0), `confirmation.spec.ts` (4, replacing 4 — net 0), and `orders.spec.ts` (2, replacing 2 — net 0) all pass; `admin.spec.ts`'s order-related tests pass (no count change, only fixture/assertion edits). Failures: still exactly the 3 documented ones from Task 2. Total test count unchanged from Task 3: 57, failed: 3, passed: 54 (every file this task touches is a like-for-like replacement, not a net addition).

- [ ] **Step 12: Commit**

```bash
git add src/app/core/models/order.model.ts src/app/core/services/order.service.ts src/app/core/services/order.service.spec.ts src/app/pages/checkout/checkout.ts src/app/pages/checkout/checkout.spec.ts src/app/pages/checkout/confirmation.ts src/app/pages/checkout/confirmation.spec.ts src/app/pages/orders/orders.ts src/app/pages/orders/orders.spec.ts src/app/pages/admin/admin.ts src/app/pages/admin/admin.spec.ts
git commit -m "feat(frontend): swap OrderService from Firestore to the API, update every consumer"
```

---

### Task 5: Remove Firebase dependencies

**Files:**
- Modify: `ko_front/package.json`
- Modify: `ko_front/package-lock.json` (via `npm uninstall`, not hand-edited)

**Interfaces:** None — this task removes now-unused dependencies. No file in the app imports from `@angular/fire/*` or `firebase/*` after Tasks 1-4 (verified in Step 1 below).

- [ ] **Step 1: Confirm nothing still imports Firebase**

Run: `grep -rn "@angular/fire\|from 'firebase" src/`
Expected: no matches. If anything matches, stop and report — do not proceed with removal until it's empty (this plan's earlier tasks are the only ones that should have touched Firebase usage, and Task 4's commit should have been the last one).

- [ ] **Step 2: Remove the packages**

Run: `npm uninstall firebase @angular/fire`
Expected: `package.json`'s `dependencies` no longer lists `firebase` or `@angular/fire`; `package-lock.json` is regenerated accordingly.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: same result as the end of Task 4 — 57 tests, 3 failed (the documented, out-of-scope ones), 54 passed. Removing unused dependencies must not change any test outcome.

- [ ] **Step 4: Confirm the app still builds**

Run: `npm run build`
Expected: builds successfully with no errors (warnings about unrelated existing issues, if any, are not this task's concern — only a build failure caused by the removed packages would block this step).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(frontend): remove firebase and @angular/fire, unused after the API migration"
```

---

### Task 6: Manual acceptance run

**Files:** none (verification only, no commit)

- [ ] **Step 1: Start the backend**

From `ko_back/`: `docker compose up -d`, `uv run python -m app.scripts.seed_admin`, `uv run uvicorn app.main:app --reload` (background).
Expected: `http://127.0.0.1:8000/health` returns `{"status":"ok"}`.

- [ ] **Step 2: Start the frontend**

From `ko_front/`: `ng serve` (background).
Expected: `http://localhost:4200` loads the home page with no console errors related to `HttpClient`, CORS, or missing providers.

- [ ] **Step 3: Register a new customer and browse the menu**

In the browser: go to `/auth`, register a new account, confirm it redirects to `/home`. Go to `/menu`, confirm products loaded from the API render (if the database is empty at this point, create one product as the seeded admin first — see Step 5 — then reload `/menu`).

- [ ] **Step 4: Add to cart and check out**

Add a product to the cart, go to `/checkout`, fill the pickup form, submit. Confirm it navigates to `/checkout/confirmacion/<id>` and shows the order with the correct total. Go to `/pedidos` ("Mis pedidos") and confirm the same order appears.

- [ ] **Step 5: Log in as admin and manage products/orders**

Log out, log in as `admin@email.com` / `admin123`. Go to `/admin`. Create a product via the form (confirm the "sembrar productos" button is gone and the empty-state message reads "No hay productos todavía." with no button when there are zero products). Edit and delete a product, confirming the list updates. Switch to the "Pedidos" tab, confirm the order from Step 4 appears, change its status, confirm it updates.

- [ ] **Step 6: Confirm session persistence**

Reload the page while logged in as admin. Confirm the session survives the reload (no redirect to `/auth`) — this is `AuthService`'s constructor-time `loadCurrentUser()` call working as designed.

- [ ] **Step 7: Stop both dev servers**

Kill the backgrounded `uvicorn` and `ng serve` processes.

---

## Self-Review Notes

- Spec coverage: HTTP client + interceptor ✅ (Task 1), AuthService/guard swap ✅ (Task 2), ProductService swap + seed removal ✅ (Task 3), OrderService swap + all consumers ✅ (Task 4), Firebase dependency removal ✅ (Task 5), manual acceptance ✅ (Task 6). Non-goals (no visual changes, no role-based nav yet, no real-time updates, no `ko_back` changes) correctly have no task — every task's diff is service/model/config/test internals plus the minimum consumer signature updates.
- Type/name consistency checked: `ProductService.create/update/remove` (Task 3) signatures match every call site added/kept in `admin.ts`. `OrderService.create/getMine/getAll/getById/updateStatus` (Task 4) signatures match every call site in `checkout.ts`, `confirmation.ts`, `orders.ts`, and `admin.ts`. `CreateOrderInput` (Task 4, in `order.model.ts`) matches exactly what `checkout.ts` builds and what `OrderService.create` accepts. `AppUser` (Task 2) is read only by `AuthService` internals and `navbar.spec.ts`'s fake — no other file reads its fields directly, so the `uid`/`displayName` → `id`/`role` shape change needed no further propagation.
- The documented pre-existing test baseline (5 failures before Task 1; 3 remaining, unrelated ones after Task 2) is the load-bearing piece of every task's "run tests" step — re-read the Global Constraints section's baseline table before executing this plan if resuming after a break, so a stale mental model doesn't get mistaken for a regression.
