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
