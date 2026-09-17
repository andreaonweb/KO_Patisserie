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
  currentUser = signal<{ id: number } | undefined>({ id: 1 });
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
    expect(watchByUser).toHaveBeenCalledWith('1');
    expect(component.orders()).toEqual(SAMPLE_ORDERS);
  });
});
