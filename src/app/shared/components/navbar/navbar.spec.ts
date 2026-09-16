import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { provideRouter } from '@angular/router';
import { NavbarComponent } from './navbar';
import { AuthService } from '../../../core/services/auth.service';
import { CartService } from '../../../core/services/cart.service';
import type { CartItem } from '../../../core/services/cart.service';
import type { Product } from '../../../core/models/product.model';

@Component({ standalone: true, template: '' })
class DummyCheckoutComponent {}

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
        provideRouter([{ path: 'checkout', component: DummyCheckoutComponent }]),
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
