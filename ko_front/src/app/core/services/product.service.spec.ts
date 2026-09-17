import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ProductService } from './product.service';
import { environment } from '../../../environments/environment';

const API_PRODUCT = {
  id: 1,
  name: 'Mochi de Fresa',
  price: 3.5,
  description: 'Tierno mochi relleno de anko y fresas frescas.',
  emoji: '🍓',
  category: 'mochi' as const,
  is_new: false,
  created_at: '2026-01-01T00:00:00',
};

async function createService(initialRows: unknown[] = []): Promise<{ service: ProductService; httpMock: HttpTestingController }> {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const service = TestBed.inject(ProductService);
  const httpMock = TestBed.inject(HttpTestingController);
  httpMock.expectOne(`${environment.apiUrl}/products`).flush(initialRows);
  await Promise.resolve();
  return { service, httpMock };
}

describe('ProductService', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('should create', async () => {
    const { service } = await createService();
    expect(service).toBeTruthy();
  });

  it('exposes an empty products signal when the API returns none', async () => {
    const { service } = await createService();
    expect(service.products()).toEqual([]);
  });

  it('loads products from the API and maps is_new to isNew', async () => {
    const { service } = await createService([API_PRODUCT]);
    expect(service.products()).toEqual([
      {
        id: 1,
        name: 'Mochi de Fresa',
        price: 3.5,
        description: 'Tierno mochi relleno de anko y fresas frescas.',
        emoji: '🍓',
        category: 'mochi',
        isNew: false,
      },
    ]);
  });

  it('create() posts the mapped product and reloads the list', async () => {
    const { service, httpMock } = await createService();
    const createPromise = service.create({
      name: 'Mochi de Fresa',
      price: 3.5,
      description: 'Tierno mochi relleno de anko y fresas frescas.',
      emoji: '🍓',
      category: 'mochi',
      isNew: true,
    });

    const postReq = httpMock.expectOne(`${environment.apiUrl}/products`);
    expect(postReq.request.method).toBe('POST');
    expect(postReq.request.body).toEqual({
      name: 'Mochi de Fresa',
      price: 3.5,
      description: 'Tierno mochi relleno de anko y fresas frescas.',
      emoji: '🍓',
      category: 'mochi',
      is_new: true,
    });
    postReq.flush({ ...API_PRODUCT, is_new: true });
    await Promise.resolve();

    httpMock.expectOne(`${environment.apiUrl}/products`).flush([{ ...API_PRODUCT, is_new: true }]);
    await createPromise;

    expect(service.products()[0].isNew).toBe(true);
  });

  it('update() puts the mapped changes to the product id and reloads the list', async () => {
    const { service, httpMock } = await createService();
    const updatePromise = service.update(1, {
      name: 'Mochi Actualizado',
      price: 4.0,
      description: 'd',
      emoji: '🍓',
      category: 'mochi',
      isNew: false,
    });

    const putReq = httpMock.expectOne(`${environment.apiUrl}/products/1`);
    expect(putReq.request.method).toBe('PUT');
    expect(putReq.request.body).toEqual({
      name: 'Mochi Actualizado',
      price: 4.0,
      description: 'd',
      emoji: '🍓',
      category: 'mochi',
      is_new: false,
    });
    putReq.flush({ ...API_PRODUCT, name: 'Mochi Actualizado', price: 4.0 });
    await Promise.resolve();

    httpMock.expectOne(`${environment.apiUrl}/products`).flush([]);
    await updatePromise;
  });

  it('remove() deletes the product by id and reloads the list', async () => {
    const { service, httpMock } = await createService();
    const removePromise = service.remove(1);

    const deleteReq = httpMock.expectOne(`${environment.apiUrl}/products/1`);
    expect(deleteReq.request.method).toBe('DELETE');
    deleteReq.flush(null);
    await Promise.resolve();

    httpMock.expectOne(`${environment.apiUrl}/products`).flush([]);
    await removePromise;
  });
});
