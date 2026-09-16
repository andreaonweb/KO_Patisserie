import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Firestore } from '@angular/fire/firestore';
import { OrderService } from './order.service';
import type { Order } from '../models/order.model';

const mockCollection = vi.fn().mockReturnValue('orders-collection');
const mockDoc = vi.fn().mockReturnValue('order-doc-ref');
const mockAddDoc = vi.fn().mockResolvedValue({ id: 'new-order-id' });
const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);
const mockGetDoc = vi.fn();
const mockQuery = vi.fn().mockReturnValue('orders-query');
const mockWhere = vi.fn().mockReturnValue('where-userId');
const mockOrderBy = vi.fn().mockReturnValue('orderBy-createdAt');
const mockCollectionData = vi.fn().mockReturnValue(of([]));

vi.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  collectionData: (...args: unknown[]) => mockCollectionData(...args),
}));

const SAMPLE_ORDER_INPUT = {
  userId: 'user-1',
  items: [{ productId: 'p1', name: 'Mochi de Fresa', price: 3.5, quantity: 2 }],
  total: 7,
  pickupName: 'Ana',
  pickupPhone: '600111222',
  pickupTime: 'Hoy 18:00',
};

function createService(): OrderService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [OrderService, { provide: Firestore, useValue: {} }],
  });
  return TestBed.inject(OrderService);
}

describe('OrderService', () => {
  beforeEach(() => {
    mockCollection.mockClear();
    mockDoc.mockClear();
    mockAddDoc.mockClear();
    mockUpdateDoc.mockClear();
    mockGetDoc.mockClear();
    mockQuery.mockClear();
    mockWhere.mockClear();
    mockOrderBy.mockClear();
    mockCollectionData.mockClear();
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  it('should create', () => {
    expect(createService()).toBeTruthy();
  });

  it('create() adds a document with status "pendiente" and the current timestamp', async () => {
    const service = createService();
    const id = await service.create(SAMPLE_ORDER_INPUT);
    expect(mockAddDoc).toHaveBeenCalledWith('orders-collection', {
      ...SAMPLE_ORDER_INPUT,
      status: 'pendiente',
      createdAt: 1700000000000,
    });
    expect(id).toBe('new-order-id');
  });

  it('watchByUser() queries by userId ordered by createdAt desc', () => {
    const service = createService();
    service.watchByUser('user-1');
    expect(mockWhere).toHaveBeenCalledWith('userId', '==', 'user-1');
    expect(mockOrderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(mockQuery).toHaveBeenCalledWith('orders-collection', 'where-userId', 'orderBy-createdAt');
    expect(mockCollectionData).toHaveBeenCalledWith('orders-query', { idField: 'id' });
  });

  it('watchAll() queries every order ordered by createdAt desc', () => {
    const service = createService();
    service.watchAll();
    expect(mockOrderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(mockQuery).toHaveBeenCalledWith('orders-collection', 'orderBy-createdAt');
    expect(mockCollectionData).toHaveBeenCalledWith('orders-query', { idField: 'id' });
  });

  it('updateStatus() writes the new status to the order document', async () => {
    const service = createService();
    await service.updateStatus('order-1', 'listo');
    expect(mockDoc).toHaveBeenCalledWith('orders-collection', 'order-1');
    expect(mockUpdateDoc).toHaveBeenCalledWith('order-doc-ref', { status: 'listo' });
  });

  it('getById() returns the order when the document exists', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      id: 'order-1',
      data: () => ({ ...SAMPLE_ORDER_INPUT, status: 'pendiente', createdAt: 1700000000000 }),
    });
    const service = createService();
    const order = await service.getById('order-1');
    expect(mockDoc).toHaveBeenCalledWith('orders-collection', 'order-1');
    expect(order).toEqual<Order>({
      id: 'order-1',
      ...SAMPLE_ORDER_INPUT,
      status: 'pendiente',
      createdAt: 1700000000000,
    });
  });

  it('getById() returns undefined when the document does not exist', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    const service = createService();
    const order = await service.getById('missing');
    expect(order).toBeUndefined();
  });
});
