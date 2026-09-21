import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
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

  describe('live updates', () => {
    afterEach(() => vi.useRealTimers());

    const setup = (source: ReturnType<typeof vi.fn>) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [OrdersComponent],
        providers: [{ provide: OrderService, useValue: { getMine: source } }],
      });
      return TestBed.createComponent(OrdersComponent).componentInstance;
    };

    it('polls and shows a status change made by the admin without reloading', async () => {
      vi.useFakeTimers();
      const listo: Order[] = [{ ...SAMPLE_ORDERS[0], status: 'listo' }];
      const source = vi.fn().mockReturnValueOnce(of(SAMPLE_ORDERS)).mockReturnValue(of(listo));
      const c = setup(source);

      await vi.advanceTimersByTimeAsync(0);
      expect(c.orders()[0].status).toBe('pendiente');

      await vi.advanceTimersByTimeAsync(10_000);
      expect(source).toHaveBeenCalledTimes(2);
      expect(c.orders()[0].status).toBe('listo');
    });

    it('keeps showing the last orders when a refresh fails, and clears the error on recovery', async () => {
      vi.useFakeTimers();
      const source = vi
        .fn()
        .mockReturnValueOnce(of(SAMPLE_ORDERS))
        .mockReturnValueOnce(throwError(() => new Error('offline')))
        .mockReturnValue(of(SAMPLE_ORDERS));
      const c = setup(source);

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(c.orders()).toEqual(SAMPLE_ORDERS);
      expect(c.loadError()).toBe('offline');

      await vi.advanceTimersByTimeAsync(10_000);
      expect(c.loadError()).toBe('');
    });

    it('stops polling when the component is destroyed', async () => {
      vi.useFakeTimers();
      const source = vi.fn().mockReturnValue(of(SAMPLE_ORDERS));
      setup(source);
      await vi.advanceTimersByTimeAsync(0);
      TestBed.resetTestingModule();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(source).toHaveBeenCalledTimes(1);
    });
  });
});
