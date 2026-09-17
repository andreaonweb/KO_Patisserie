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
