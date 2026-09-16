import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Firestore } from '@angular/fire/firestore';
import { ProductService } from './product.service';
import type { Product } from '../models/product.model';

const mockCollection = vi.fn().mockReturnValue('products-collection');
const mockDoc = vi.fn().mockReturnValue('product-doc-ref');
const mockAddDoc = vi.fn().mockResolvedValue({ id: 'new-id' });
const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);
const mockDeleteDoc = vi.fn().mockResolvedValue(undefined);
const mockCollectionData = vi.fn().mockReturnValue(of([]));

vi.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  collectionData: (...args: unknown[]) => mockCollectionData(...args),
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
}));

const SAMPLE_PRODUCT: Omit<Product, 'id'> = {
  name: 'Mochi de Fresa',
  price: 3.5,
  description: 'Tierno mochi relleno de anko y fresas frescas.',
  emoji: '🍓',
  category: 'mochi',
};

function createService(initialProducts: Product[] = []): ProductService {
  mockCollectionData.mockReturnValue(of(initialProducts));
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [ProductService, { provide: Firestore, useValue: {} }],
  });
  return TestBed.inject(ProductService);
}

describe('ProductService', () => {
  beforeEach(() => {
    mockCollection.mockClear();
    mockDoc.mockClear();
    mockAddDoc.mockClear();
    mockUpdateDoc.mockClear();
    mockDeleteDoc.mockClear();
  });

  it('should create', () => {
    expect(createService()).toBeTruthy();
  });

  it('exposes an empty products signal when the collection is empty', () => {
    const service = createService();
    expect(service.products()).toEqual([]);
  });

  it('create() adds a document to the products collection', async () => {
    const service = createService();
    await service.create(SAMPLE_PRODUCT);
    expect(mockAddDoc).toHaveBeenCalledWith('products-collection', SAMPLE_PRODUCT);
  });

  it('update() writes changes to the product document', async () => {
    const service = createService();
    const changes = { ...SAMPLE_PRODUCT, name: 'Mochi Actualizado' };
    await service.update('abc123', changes);
    expect(mockDoc).toHaveBeenCalledWith('products-collection', 'abc123');
    expect(mockUpdateDoc).toHaveBeenCalledWith('product-doc-ref', changes);
  });

  it('remove() deletes the product document', async () => {
    const service = createService();
    await service.remove('abc123');
    expect(mockDoc).toHaveBeenCalledWith('products-collection', 'abc123');
    expect(mockDeleteDoc).toHaveBeenCalledWith('product-doc-ref');
  });

  it('seedIfEmpty() adds every sample product when the collection is empty', async () => {
    const service = createService([]);
    await service.seedIfEmpty([SAMPLE_PRODUCT]);
    expect(mockAddDoc).toHaveBeenCalledTimes(1);
    expect(mockAddDoc).toHaveBeenCalledWith('products-collection', SAMPLE_PRODUCT);
  });

  it('seedIfEmpty() does nothing when products already exist', async () => {
    const service = createService([{ id: '1', ...SAMPLE_PRODUCT }]);
    await service.seedIfEmpty([SAMPLE_PRODUCT]);
    expect(mockAddDoc).not.toHaveBeenCalled();
  });
});
