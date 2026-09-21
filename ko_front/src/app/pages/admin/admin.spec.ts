import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import { AdminComponent } from './admin';
import { ProductService } from '../../core/services/product.service';
import { OrderService } from '../../core/services/order.service';
import { ChatService } from '../../core/services/chat.service';
import { RealtimeService } from '../../core/services/realtime.service';
import type { ServerEvent } from '../../core/models/realtime.model';
import type { Product } from '../../core/models/product.model';
import type { Order, OrderStatus } from '../../core/models/order.model';

class FakeProductService {
  products = signal<Product[]>([]);
  create = vi.fn().mockResolvedValue(undefined);
  update = vi.fn().mockResolvedValue(undefined);
  remove = vi.fn().mockResolvedValue(undefined);
  uploadImage = vi.fn().mockResolvedValue('http://api/uploads/new.jpg');
}

class FakeOrderService {
  getAll = vi.fn().mockReturnValue(of([]));
  updateStatus = vi.fn().mockResolvedValue(undefined);
}

class FakeChatService {
  adminUnreadTotal = signal(0);
  // Lo que usa el componente hijo `app-admin-chat` cuando se abre la pestaña:
  threads = signal([]);
  activeCustomerId = signal<number | null>(null);
  activeMessages = signal([]);
  canSend = signal(true);
  loadError = signal('');
  openThread = vi.fn();
  closeThread = vi.fn();
  sendTo = vi.fn();
}

class FakeRealtime {
  events = new Subject<ServerEvent>();
  reconnected = new Subject<void>();
  events$ = this.events.asObservable();
  reconnected$ = this.reconnected.asObservable();
}

const apiOrder = (over: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 2,
  items: [{ product_id: 1, name: 'Mochi de Fresa', price: 3.5, quantity: 2 }],
  total: 7,
  pickup_name: 'Ana',
  pickup_phone: '600111222',
  pickup_time: '2026-09-22T18:00',
  status: 'pendiente',
  created_at: '2023-11-14T22:13:20',
  ...over,
});

const SAMPLE_PRODUCT: Product = {
  id: 1,
  name: 'Mochi de Fresa',
  price: 3.5,
  description: 'Tierno mochi relleno de anko y fresas frescas.',
  emoji: '🍓',
  category: 'mochi',
};

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

describe('AdminComponent', () => {
  let component: AdminComponent;
  let fixture: ComponentFixture<AdminComponent>;
  let productService: FakeProductService;
  let orderService: FakeOrderService;
  let realtime: FakeRealtime;

  beforeEach(async () => {
    realtime = new FakeRealtime();
    await TestBed.configureTestingModule({
      imports: [AdminComponent],
      providers: [
        { provide: ProductService, useClass: FakeProductService },
        { provide: OrderService, useClass: FakeOrderService },
        { provide: ChatService, useClass: FakeChatService },
        { provide: RealtimeService, useValue: realtime },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminComponent);
    component = fixture.componentInstance;
    productService = TestBed.inject(ProductService) as unknown as FakeProductService;
    orderService = TestBed.inject(OrderService) as unknown as FakeOrderService;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the Chat tab with the unread total', () => {
    const chat = TestBed.inject(ChatService) as unknown as FakeChatService;
    chat.adminUnreadTotal.set(3);
    fixture.detectChanges();
    const tabs = Array.from(fixture.nativeElement.querySelectorAll('.admin__tab')) as HTMLElement[];
    const chatTab = tabs.find(t => t.textContent?.includes('Chat'))!;
    expect(chatTab.querySelector('.admin__tab-badge')?.textContent?.trim()).toBe('3');
  });

  it('switches to the chat panel', () => {
    component.activeTab.set('chat');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-admin-chat')).not.toBeNull();
  });

  it('form is invalid when required fields are empty', () => {
    expect(component.form.invalid).toBe(true);
  });

  it('form is valid once required fields are filled', () => {
    component.form.setValue({
      name: 'Mochi de Fresa',
      price: 3.5,
      description: 'Tierno mochi.',
      category: 'mochi',
      imageUrl: '',
      isNew: false,
    });
    expect(component.form.valid).toBe(true);
  });

  it('submit() calls productService.create with the form value and an empty emoji when not editing', async () => {
    component.form.setValue({
      name: 'Mochi de Fresa',
      price: 3.5,
      description: 'Tierno mochi relleno de anko y fresas frescas.',
      category: 'mochi',
      imageUrl: '',
      isNew: false,
    });

    await component.submit();

    expect(productService.create).toHaveBeenCalledWith({
      name: 'Mochi de Fresa',
      price: 3.5,
      description: 'Tierno mochi relleno de anko y fresas frescas.',
      emoji: '',
      category: 'mochi',
      imageUrl: null,
      isNew: false,
    });
    expect(component.editingId()).toBeNull();
  });

  it('startEdit() patches the form and submit() calls productService.update, preserving the original emoji', async () => {
    component.startEdit(SAMPLE_PRODUCT);

    expect(component.editingId()).toBe(1);
    expect(component.form.value.name).toBe('Mochi de Fresa');

    await component.submit();

    expect(productService.update).toHaveBeenCalledWith(1, {
      name: 'Mochi de Fresa',
      price: 3.5,
      description: 'Tierno mochi relleno de anko y fresas frescas.',
      emoji: '🍓',
      category: 'mochi',
      imageUrl: null,
      isNew: false,
    });
    expect(component.editingId()).toBeNull();
  });

  it('remove() asks for confirmation and calls productService.remove when confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await component.remove(SAMPLE_PRODUCT);

    expect(window.confirm).toHaveBeenCalledWith('¿Borrar "Mochi de Fresa"?');
    expect(productService.remove).toHaveBeenCalledWith(1);
  });

  it('remove() does nothing when the user cancels the confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    await component.remove(SAMPLE_PRODUCT);

    expect(productService.remove).not.toHaveBeenCalled();
  });

  it('startEdit() does not carry a stale isNew value over from a previous edit', () => {
    component.startEdit({ ...SAMPLE_PRODUCT, isNew: true });
    expect(component.form.value.isNew).toBe(true);

    const productWithoutIsNew: Product = {
      id: 2,
      name: 'Donut Sakura',
      price: 4.2,
      description: 'Glaseado rosa con pétalos de rosa comestibles.',
      emoji: '🌸',
      category: 'donut',
    };
    component.startEdit(productWithoutIsNew);

    expect(component.form.value.isNew).toBe(false);
  });

  it('defaults to the "productos" tab', () => {
    expect(component.activeTab()).toBe('productos');
  });

  it('exposes orders from OrderService.getAll()', () => {
    expect(component.orders()).toEqual([]);
  });

  it('changeStatus() calls orderService.updateStatus with the new status', async () => {
    await component.changeStatus(SAMPLE_ORDER, 'listo' as OrderStatus);
    expect(orderService.updateStatus).toHaveBeenCalledWith(1, 'listo');
  });

  it('changeStatus() surfaces an error when the update fails', async () => {
    orderService.updateStatus.mockRejectedValue(new Error('offline'));
    await component.changeStatus(SAMPLE_ORDER, 'listo' as OrderStatus);
    expect(component.orderError()).toContain('offline');
  });

  describe('filters and pagination', () => {
    const product = (id: number, name: string, price: number, category: Product['category']): Product => ({
      id, name, price, category, description: '', emoji: '',
    });

    beforeEach(() => {
      productService.products.set([
        product(1, 'Mochi de matcha', 3.6, 'mochi'),
        product(2, 'Café de filtro', 2.8, 'drink'),
        product(3, 'Tarta de matcha', 5.2, 'cake'),
      ]);
    });

    it('searches products ignoring case and accents', () => {
      component.setProductFilter({ q: 'CAFE' });
      expect(component.filteredProducts().map(p => p.id)).toEqual([2]);
    });

    it('combines category and price range', () => {
      component.setProductFilter({ q: 'matcha', min: 4 });
      expect(component.filteredProducts().map(p => p.id)).toEqual([3]);
      component.setProductFilter({ min: null, category: 'mochi' });
      expect(component.filteredProducts().map(p => p.id)).toEqual([1]);
    });

    it('clearProductFilters() restores the full list', () => {
      component.setProductFilter({ q: 'zzz' });
      expect(component.filteredProducts()).toHaveLength(0);
      component.clearProductFilters();
      expect(component.filteredProducts()).toHaveLength(3);
      expect(component.hasProductFilters()).toBe(false);
    });

    it('paginates products and resets to page 1 when filtering', () => {
      productService.products.set(Array.from({ length: 20 }, (_, i) => product(i + 1, `P${i + 1}`, 1, 'mochi')));
      expect(component.productPages()).toBe(3);
      component.goToProductPage(3);
      expect(component.pagedProducts()).toHaveLength(4);
      component.setProductFilter({ q: 'P1' });
      expect(component.productPage()).toBe(1);
    });

    it('filters and paginates orders', async () => {
      const orders: Order[] = Array.from({ length: 10 }, (_, i) => ({
        ...SAMPLE_ORDER,
        id: i + 1,
        total: i + 1,
        pickupName: i === 0 ? 'Lucía' : 'Ana',
        status: i % 2 ? 'listo' : 'pendiente',
      }));
      orderService.getAll.mockReturnValue(of(orders));
      const f = TestBed.createComponent(AdminComponent);
      const c = f.componentInstance;
      await vi.waitFor(() => expect(c.orderPages()).toBe(2));
      expect(c.pagedOrders()).toHaveLength(8);
      c.setOrderFilter({ q: 'lucia' });
      expect(c.filteredOrders().map(o => o.id)).toEqual([1]);
      c.setOrderFilter({ q: '', status: 'listo', min: 5 });
      expect(c.filteredOrders().map(o => o.id)).toEqual([6, 8, 10]);
    });
  });

  describe('image upload', () => {
    const input = (file?: File) => ({ files: file ? [file] : [], value: 'x' }) as unknown as HTMLInputElement;
    const jpg = (size = 10) => new File([new Uint8Array(size)], 'a.jpg', { type: 'image/jpeg' });

    it('uploads the chosen file and stores the returned URL in the form', async () => {
      await component.onImageSelected(input(jpg()));
      expect(productService.uploadImage).toHaveBeenCalled();
      expect(component.form.controls.imageUrl.value).toBe('http://api/uploads/new.jpg');
      expect(component.uploading()).toBe(false);
    });

    it('rejects unsupported formats without calling the API', async () => {
      await component.onImageSelected(input(new File(['x'], 'a.gif', { type: 'image/gif' })));
      expect(productService.uploadImage).not.toHaveBeenCalled();
      expect(component.imageError()).toContain('Formato');
    });

    it('rejects files over 5 MB without calling the API', async () => {
      await component.onImageSelected(input(jpg(5 * 1024 * 1024 + 1)));
      expect(productService.uploadImage).not.toHaveBeenCalled();
      expect(component.imageError()).toContain('5 MB');
    });

    it('shows the server error when the upload fails', async () => {
      productService.uploadImage.mockRejectedValue({ error: { detail: 'La imagen supera los 5 MB' } });
      await component.onImageSelected(input(jpg()));
      expect(component.imageError()).toBe('La imagen supera los 5 MB');
      expect(component.form.controls.imageUrl.value).toBe('');
    });

    it('removeImage() clears the photo', async () => {
      await component.onImageSelected(input(jpg()));
      component.removeImage();
      expect(component.form.controls.imageUrl.value).toBe('');
    });
  });

  describe('live orders', () => {
    it('loads the orders once over REST', async () => {
      fixture.destroy(); // el componente del beforeEach también llamó a getAll
      orderService.getAll.mockClear();
      orderService.getAll.mockReturnValue(of([SAMPLE_ORDER]));
      const c = TestBed.createComponent(AdminComponent).componentInstance;
      await vi.waitFor(() => expect(c.orders()).toHaveLength(1));
      expect(orderService.getAll).toHaveBeenCalledTimes(1);
    });

    it('adds an order placed by a customer as soon as the event arrives', async () => {
      orderService.getAll.mockReturnValue(of([SAMPLE_ORDER]));
      const c = TestBed.createComponent(AdminComponent).componentInstance;
      await vi.waitFor(() => expect(c.orders()).toHaveLength(1));

      realtime.events.next({
        type: 'order.created',
        order: apiOrder({ id: 2, created_at: '2023-11-15T10:00:00' }),
      } as ServerEvent);

      expect(c.orders().map(o => o.id)).toEqual([2, 1]);
    });

    it('applies a status change made elsewhere', async () => {
      orderService.getAll.mockReturnValue(of([SAMPLE_ORDER]));
      const c = TestBed.createComponent(AdminComponent).componentInstance;
      await vi.waitFor(() => expect(c.orders()).toHaveLength(1));

      realtime.events.next({ type: 'order.updated', order: apiOrder({ status: 'entregado' }) } as ServerEvent);

      expect(c.orders()[0].status).toBe('entregado');
    });

    it('keeps a live event that arrives while the initial load is still pending', async () => {
      const pending = new Subject<Order[]>();
      orderService.getAll.mockReturnValue(pending.asObservable());
      const c = TestBed.createComponent(AdminComponent).componentInstance;

      realtime.events.next({ type: 'order.updated', order: apiOrder({ status: 'entregado' }) } as ServerEvent);
      pending.next([SAMPLE_ORDER]); // instantánea más antigua: sigue "pendiente"
      pending.complete();

      await vi.waitFor(() => expect(c.orders()).toHaveLength(1));
      expect(c.orders()[0].status).toBe('entregado');
    });

    it('reflects its own status change immediately, even if the socket is down', async () => {
      orderService.getAll.mockReturnValue(of([SAMPLE_ORDER]));
      const c = TestBed.createComponent(AdminComponent).componentInstance;
      await vi.waitFor(() => expect(c.orders()).toHaveLength(1));

      await c.changeStatus(c.orders()[0], 'listo');

      expect(orderService.updateStatus).toHaveBeenCalledWith(1, 'listo');
      expect(c.orders()[0].status).toBe('listo');
    });

    it('does not change the list when the status update fails', async () => {
      orderService.getAll.mockReturnValue(of([SAMPLE_ORDER]));
      orderService.updateStatus.mockRejectedValue(new Error('offline'));
      const c = TestBed.createComponent(AdminComponent).componentInstance;
      await vi.waitFor(() => expect(c.orders()).toHaveLength(1));

      await c.changeStatus(c.orders()[0], 'listo');

      expect(c.orders()[0].status).toBe('pendiente');
      expect(c.orderError()).toContain('offline');
    });

    it('reloads after a reconnection and keeps the last orders if that fails', async () => {
      fixture.destroy(); // que el componente del beforeEach no consuma las respuestas ni escuche la reconexión
      orderService.getAll.mockReturnValueOnce(of([SAMPLE_ORDER])).mockReturnValueOnce(throwError(() => new Error('offline')));
      const c = TestBed.createComponent(AdminComponent).componentInstance;
      await vi.waitFor(() => expect(c.orders()).toHaveLength(1));

      realtime.reconnected.next();

      await vi.waitFor(() => expect(c.ordersLoadError()).toBe('offline'));
      expect(c.orders()).toHaveLength(1);
    });
  });
});
