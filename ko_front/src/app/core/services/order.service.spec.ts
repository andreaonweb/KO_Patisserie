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
