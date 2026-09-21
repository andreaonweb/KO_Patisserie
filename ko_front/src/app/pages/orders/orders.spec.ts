import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { OrdersComponent } from './orders';
import { OrderService } from '../../core/services/order.service';
import { RealtimeService } from '../../core/services/realtime.service';
import type { Order } from '../../core/models/order.model';
import type { ServerEvent } from '../../core/models/realtime.model';

const SAMPLE_ORDERS: Order[] = [
  {
    id: 1,
    userId: 2,
    items: [{ productId: 1, name: 'Mochi de Fresa', price: 3.5, quantity: 2 }],
    total: 7,
    pickupName: 'Ana',
    pickupPhone: '600111222',
    pickupTime: '2026-09-22T18:00',
    status: 'pendiente',
    createdAt: 1700000000000,
  },
];

const apiOrder = (over: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 2,
  items: [{ product_id: 1, name: 'Mochi de Fresa', price: 3.5, quantity: 2 }],
  total: 7,
  pickup_name: 'Ana',
  pickup_phone: '600111222',
  pickup_time: '2026-09-22T18:00',
  status: 'listo',
  created_at: '2023-11-14T22:13:20',
  ...over,
});

class FakeRealtime {
  events = new Subject<ServerEvent>();
  reconnected = new Subject<void>();
  events$ = this.events.asObservable();
  reconnected$ = this.reconnected.asObservable();
}

describe('OrdersComponent', () => {
  let component: OrdersComponent;
  let fixture: ComponentFixture<OrdersComponent>;
  let getMine: ReturnType<typeof vi.fn>;
  let realtime: FakeRealtime;

  beforeEach(async () => {
    getMine = vi.fn().mockReturnValue(of(SAMPLE_ORDERS));
    realtime = new FakeRealtime();

    await TestBed.configureTestingModule({
      imports: [OrdersComponent],
      providers: [
        { provide: OrderService, useValue: { getMine } },
        { provide: RealtimeService, useValue: realtime },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrdersComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads the orders of the current user once', () => {
    expect(getMine).toHaveBeenCalledTimes(1);
    expect(component.orders()).toEqual(SAMPLE_ORDERS);
  });

  it('shows a status change pushed by the admin without reloading', () => {
    realtime.events.next({ type: 'order.updated', order: apiOrder({ status: 'listo' }) } as ServerEvent);
    expect(component.orders()).toHaveLength(1);
    expect(component.orders()[0].status).toBe('listo');
    expect(getMine).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated events', () => {
    realtime.events.next({ type: 'error', code: 'x', detail: 'y' });
    expect(component.orders()).toEqual(SAMPLE_ORDERS);
  });

  it('reloads after a reconnection, in case events were missed', async () => {
    getMine.mockReturnValue(of([{ ...SAMPLE_ORDERS[0], status: 'entregado' }]));
    realtime.reconnected.next();
    await vi.waitFor(() => expect(component.orders()[0].status).toBe('entregado'));
    expect(getMine).toHaveBeenCalledTimes(2);
  });

  it('keeps an event that arrives while the load is still in flight', async () => {
    const pending = new Subject<Order[]>();
    getMine.mockReturnValue(pending);
    realtime.reconnected.next();
    realtime.events.next({ type: 'order.updated', order: apiOrder({ status: 'listo' }) } as ServerEvent);
    pending.next([{ ...SAMPLE_ORDERS[0], status: 'pendiente' }]);
    pending.complete();
    await vi.waitFor(() => expect(getMine).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(component.orders()[0].status).toBe('listo'));
  });

  it('reports a load error and keeps the last orders', async () => {
    getMine.mockReturnValue(throwError(() => new Error('offline')));
    realtime.reconnected.next();
    await vi.waitFor(() => expect(component.loadError()).toBe('offline'));
    expect(component.orders()).toEqual(SAMPLE_ORDERS);
  });
});
