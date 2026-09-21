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
  id: 1,
  name: 'Mochi de Fresa',
  price: 3.5,
  description: 'Tierno mochi relleno de anko y fresas frescas.',
  emoji: '🍓',
  category: 'mochi',
};

class FakeAuthService {
  currentUser = signal<{ id: number; role: string } | undefined>({ id: 1, role: 'customer' });
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

  describe('accessibility', () => {
    const tick = () => new Promise(resolve => setTimeout(resolve));
    const el = (selector: string) => fixture.nativeElement.querySelector(selector) as HTMLElement | null;

    beforeEach(() => {
      cart.setItems([{ product: SAMPLE_PRODUCT, quantity: 1 }]);
    });

    it('moves focus into the cart when it opens and back to the cart button when it closes', async () => {
      const cartButton = el('.navbar__cart-btn') as HTMLButtonElement;
      cartButton.click();
      fixture.detectChanges();
      await tick();
      expect(document.activeElement).toBe(el('.cart-panel__close'));

      el('.cart-panel__close')!.click();
      fixture.detectChanges();
      await tick();
      expect(document.activeElement).toBe(cartButton);
    });

    it('closes the cart with Escape', () => {
      component.cartOpen.set(true);
      fixture.detectChanges();
      el('.cart-panel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(component.cartOpen()).toBe(false);
    });

    it('keeps Tab inside the open cart', () => {
      component.cartOpen.set(true);
      fixture.detectChanges();
      const focusable = Array.from(el('.cart-panel')!.querySelectorAll('button:not([disabled]), a[href]')) as HTMLElement[];
      const last = focusable[focusable.length - 1];
      last.focus();
      const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
      el('.cart-panel')!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(focusable[0]);
    });

    it('names the cart button with its item count and announces changes politely', () => {
      fixture.detectChanges();
      const cartButton = el('.navbar__cart-btn')!;
      expect(cartButton.getAttribute('aria-label')).toBe('Abrir carrito, 1 artículo');
      expect(cartButton.getAttribute('aria-label')!.toLowerCase()).toContain('carrito');
      expect(el('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    });

    it('declares the cart as a modal dialog', () => {
      component.cartOpen.set(true);
      fixture.detectChanges();
      expect(el('.cart-panel')!.getAttribute('aria-modal')).toBe('true');
    });
  });
});
