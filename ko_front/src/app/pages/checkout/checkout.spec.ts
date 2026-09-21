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
    component.form.setValue({ pickupName: 'Ana', pickupPhone: '600111222', pickupTime: '2026-09-22T18:00' });

    await component.submit();

    expect(orderService.create).toHaveBeenCalledWith({
      items: [{ productId: 1, quantity: 2 }],
      pickupName: 'Ana',
      pickupPhone: '600111222',
      pickupTime: '2026-09-22T18:00',
    });
    expect(cart.clear).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/checkout/confirmacion', 1]);
  });

  it('submit() shows an error and does not clear the cart when the order fails to save', async () => {
    orderService.create.mockRejectedValue(new Error('network down'));
    component.form.setValue({ pickupName: 'Ana', pickupPhone: '600111222', pickupTime: '2026-09-22T18:00' });

    await component.submit();

    expect(component.error()).toContain('network down');
    expect(cart.clear).not.toHaveBeenCalled();
  });
});
