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

  describe('mobile menu', () => {
    const tick = () => new Promise(resolve => setTimeout(resolve));
    const el = (selector: string) => fixture.nativeElement.querySelector(selector) as HTMLElement | null;
    const labels = (selector: string) =>
      (Array.from(fixture.nativeElement.querySelectorAll(selector)) as HTMLElement[]).map(a => a.textContent!.trim());
    const openMenu = () => {
      (el('.navbar__menu-btn') as HTMLButtonElement).click();
      fixture.detectChanges();
    };

    it('puts the hamburger button first, before the logo', () => {
      const header = el('.navbar')!;
      expect(header.firstElementChild).toBe(el('.navbar__menu-btn'));
      expect(header.children[1]).toBe(el('.navbar__brand'));
    });

    it('is a labelled button that reports whether the menu is open', () => {
      const button = el('.navbar__menu-btn')!;
      expect(button.getAttribute('aria-label')).toBe('Abrir menú');
      expect(button.getAttribute('aria-expanded')).toBe('false');
      openMenu();
      expect(button.getAttribute('aria-expanded')).toBe('true');
    });

    it('lists the same links as the top bar, for a customer', () => {
      openMenu();
      const menuLinks = labels('.menu-panel__links a');
      expect(menuLinks).toEqual(['Inicio', 'Menú', 'Nosotros', 'Mis pedidos']);
      expect(menuLinks).toEqual(labels('.navbar__links a'));
    });

    it('shows Admin instead of Mis pedidos for an admin', () => {
      const auth = TestBed.inject(AuthService) as unknown as { currentUser: { set(v: unknown): void } };
      auth.currentUser.set({ id: 9, role: 'admin' });
      fixture.detectChanges();
      openMenu();
      expect(labels('.menu-panel__links a')).toEqual(['Inicio', 'Menú', 'Nosotros', 'Admin']);
    });

    it('moves focus to the close button, and back to the hamburger when it closes', async () => {
      const hamburger = el('.navbar__menu-btn') as HTMLButtonElement;
      openMenu();
      await tick();
      expect(document.activeElement).toBe(el('.menu-panel__close'));

      el('.menu-panel__close')!.click();
      fixture.detectChanges();
      await tick();
      expect(document.activeElement).toBe(hamburger);
    });

    it('closes with Escape, with the overlay and when a link is chosen', () => {
      openMenu();
      el('.menu-panel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(component.menuOpen()).toBe(false);

      openMenu();
      el('.menu-overlay')!.click();
      expect(component.menuOpen()).toBe(false);

      openMenu();
      (el('.menu-panel__links a') as HTMLAnchorElement).click();
      expect(component.menuOpen()).toBe(false);
    });

    it('is a modal dialog that keeps Tab inside', () => {
      openMenu();
      const panel = el('.menu-panel')!;
      expect(panel.getAttribute('aria-modal')).toBe('true');
      const focusable = Array.from(panel.querySelectorAll('button, a[href]')) as HTMLElement[];
      focusable[focusable.length - 1].focus();
      const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
      panel.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(focusable[0]);
    });

    it('closes by itself when the window grows past the mobile breakpoint', () => {
      openMenu();
      Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
      component.onResize();
      expect(component.menuOpen()).toBe(false);
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    });
  });

  describe('cart visibility by role', () => {
    const el = (selector: string) => fixture.nativeElement.querySelector(selector) as HTMLElement | null;
    const setUser = (user: { id: number; role: string } | undefined) => {
      const auth = TestBed.inject(AuthService) as unknown as { currentUser: { set(v: unknown): void } };
      auth.currentUser.set(user);
      fixture.detectChanges();
    };

    it('shows the cart button to customers', () => {
      expect(el('.navbar__cart-btn')).not.toBeNull();
    });

    it('shows the cart button to visitors who are not logged in', () => {
      setUser(undefined);
      expect(el('.navbar__cart-btn')).not.toBeNull();
    });

    it('hides the cart button, its announcements and the cart panel for an admin', () => {
      component.cartOpen.set(true);
      fixture.detectChanges();
      expect(el('.cart-panel')).not.toBeNull();

      setUser({ id: 9, role: 'admin' });

      expect(el('.navbar__cart-btn')).toBeNull();
      expect(el('.cart-panel')).toBeNull();
      expect(el('[role="status"]')).toBeNull();
      expect(el('.navbar__auth')).not.toBeNull();
    });
  });
});
