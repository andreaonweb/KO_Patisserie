import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ProductService } from '../../core/services/product.service';
import { OrderService } from '../../core/services/order.service';
import { formatPickupTime } from '../../core/utils/pickup-slots';
import { pollWhileVisible } from '../../core/utils/poll';
import { Product } from '../../core/models/product.model';
import { ProductIconComponent } from '../../shared/components/product-icon/product-icon';
import type { Order, OrderStatus } from '../../core/models/order.model';

interface ProductFilters {
  q: string;
  category: '' | Product['category'];
  min: number | null;
  max: number | null;
}

interface OrderFilters {
  q: string;
  status: '' | OrderStatus;
  min: number | null;
  max: number | null;
}

const normalize = (v: string): string =>
  v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [ReactiveFormsModule, CurrencyPipe, DatePipe, ProductIconComponent],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
})
export class AdminComponent {
  private fb = inject(FormBuilder);
  productService = inject(ProductService);
  orderService = inject(OrderService);

  activeTab = signal<'productos' | 'pedidos'>('productos');
  ordersLoadError = signal('');
  orders = signal<Order[]>([]);
  orderError = signal('');
  private statusOverrides = signal<Record<number, OrderStatus>>({});
  readonly orderStatuses: OrderStatus[] = ['pendiente', 'listo', 'entregado'];

  editingId = signal<number | null>(null);
  private editingEmoji = '';
  error = signal('');
  saving = signal(false);
  uploading = signal(false);
  imageError = signal('');

  readonly categories: Product['category'][] = ['mochi', 'donut', 'cake', 'drink'];

  readonly formatPickupTime = formatPickupTime;
  readonly pageSize = 8;

  productFilters = signal<ProductFilters>({ q: '', category: '', min: null, max: null });
  orderFilters = signal<OrderFilters>({ q: '', status: '', min: null, max: null });
  private productPageReq = signal(1);
  private orderPageReq = signal(1);

  filteredProducts = computed(() => {
    const { q, category, min, max } = this.productFilters();
    const term = normalize(q);
    return this.productService.products().filter(p =>
      (!term || normalize(p.name).includes(term) || normalize(p.description).includes(term)) &&
      (!category || p.category === category) &&
      (min === null || p.price >= min) &&
      (max === null || p.price <= max)
    );
  });
  productPages = computed(() => Math.max(1, Math.ceil(this.filteredProducts().length / this.pageSize)));
  productPage = computed(() => Math.min(this.productPageReq(), this.productPages()));
  pagedProducts = computed(() => {
    const start = (this.productPage() - 1) * this.pageSize;
    return this.filteredProducts().slice(start, start + this.pageSize);
  });

  filteredOrders = computed(() => {
    const { q, status, min, max } = this.orderFilters();
    const term = normalize(q);
    return this.orders().filter(o =>
      (!term || normalize(`ko-${o.id} ${o.pickupName} ${o.pickupPhone} ${o.items.map(i => i.name).join(' ')}`).includes(term)) &&
      (!status || this.statusOf(o) === status) &&
      (min === null || o.total >= min) &&
      (max === null || o.total <= max)
    );
  });
  orderPages = computed(() => Math.max(1, Math.ceil(this.filteredOrders().length / this.pageSize)));
  orderPage = computed(() => Math.min(this.orderPageReq(), this.orderPages()));
  pagedOrders = computed(() => {
    const start = (this.orderPage() - 1) * this.pageSize;
    return this.filteredOrders().slice(start, start + this.pageSize);
  });

  setProductFilter(patch: Partial<ProductFilters>): void {
    this.productFilters.update(f => ({ ...f, ...patch }));
    this.productPageReq.set(1);
  }

  setOrderFilter(patch: Partial<OrderFilters>): void {
    this.orderFilters.update(f => ({ ...f, ...patch }));
    this.orderPageReq.set(1);
  }

  clearProductFilters(): void {
    this.setProductFilter({ q: '', category: '', min: null, max: null });
  }

  clearOrderFilters(): void {
    this.setOrderFilter({ q: '', status: '', min: null, max: null });
  }

  hasProductFilters = computed(() => Object.values(this.productFilters()).some(v => v !== '' && v !== null));
  hasOrderFilters = computed(() => Object.values(this.orderFilters()).some(v => v !== '' && v !== null));

  goToProductPage(n: number): void {
    this.productPageReq.set(Math.min(Math.max(1, n), this.productPages()));
  }

  goToOrderPage(n: number): void {
    this.orderPageReq.set(Math.min(Math.max(1, n), this.orderPages()));
  }

  toNum(value: string): number | null {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }

  constructor() {
    // Los pedidos nuevos y los cambios de estado aparecen sin recargar la página.
    pollWhileVisible(
      () => this.orderService.getAll(),
      e => this.ordersLoadError.set(e.message ?? 'Error al cargar los pedidos')
    )
      .pipe(takeUntilDestroyed())
      .subscribe(rows => {
        this.ordersLoadError.set('');
        this.orders.set(rows);
        this.dropConfirmedOverrides(rows);
      });
  }

  form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    price: [0, [Validators.required, Validators.min(0.01)]],
    description: ['', Validators.required],
    category: this.fb.nonNullable.control<Product['category']>('mochi', Validators.required),
    imageUrl: [''],
    isNew: [false],
  });

  startEdit(product: Product): void {
    this.editingId.set(product.id);
    this.editingEmoji = product.emoji;
    this.form.reset({ name: '', price: 0, description: '', category: 'mochi', imageUrl: '', isNew: false });
    this.form.patchValue({ ...product, imageUrl: product.imageUrl ?? '' });
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.editingEmoji = '';
    this.imageError.set('');
    this.form.reset({ name: '', price: 0, description: '', category: 'mochi', imageUrl: '', isNew: false });
  }

  async onImageSelected(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.imageError.set('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      this.imageError.set('Formato no válido: usa JPG, PNG o WebP');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.imageError.set('La imagen supera los 5 MB');
      return;
    }
    this.uploading.set(true);
    try {
      const url = await this.productService.uploadImage(file);
      this.form.patchValue({ imageUrl: url });
    } catch (e: any) {
      this.imageError.set(e.error?.detail ?? e.message ?? 'No se pudo subir la imagen');
    } finally {
      this.uploading.set(false);
    }
  }

  removeImage(): void {
    this.form.patchValue({ imageUrl: '' });
    this.imageError.set('');
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.error.set('');
    const id = this.editingId();
    const raw = this.form.getRawValue();
    const value = { ...raw, imageUrl: raw.imageUrl.trim() || null, emoji: id ? this.editingEmoji : '' };
    try {
      if (id) {
        await this.productService.update(id, value);
      } else {
        await this.productService.create(value);
      }
      this.cancelEdit();
    } catch (e: any) {
      this.error.set((e.message ?? 'Error al guardar el producto'));
    } finally {
      this.saving.set(false);
    }
  }

  async remove(product: Product): Promise<void> {
    if (!confirm(`¿Borrar "${product.name}"?`)) return;
    this.error.set('');
    try {
      await this.productService.remove(product.id);
      if (this.editingId() === product.id) this.cancelEdit();
    } catch (e: any) {
      this.error.set((e.message ?? 'Error al borrar el producto'));
    }
  }

  /**
   * El override tapa una consulta que salió antes del cambio y llega con el estado viejo.
   * En cuanto el servidor ya devuelve el estado nuevo, deja de hacer falta.
   */
  private dropConfirmedOverrides(rows: Order[]): void {
    const overrides = this.statusOverrides();
    const stale = Object.keys(overrides).map(Number).filter(id => rows.find(o => o.id === id)?.status === overrides[id]);
    if (stale.length === 0) return;
    this.statusOverrides.update(m => Object.fromEntries(Object.entries(m).filter(([id]) => !stale.includes(Number(id)))));
  }

  statusOf(order: Order): OrderStatus {
    return this.statusOverrides()[order.id] ?? order.status;
  }

  async changeStatus(order: Order, status: OrderStatus): Promise<void> {
    this.orderError.set('');
    try {
      await this.orderService.updateStatus(order.id, status);
      this.statusOverrides.update(m => ({ ...m, [order.id]: status }));
    } catch (e: any) {
      this.orderError.set((e.message ?? 'Error al actualizar el pedido'));
    }
  }
}
