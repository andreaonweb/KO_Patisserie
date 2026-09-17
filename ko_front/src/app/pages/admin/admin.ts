import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { catchError, of } from 'rxjs';
import { ProductService } from '../../core/services/product.service';
import { OrderService } from '../../core/services/order.service';
import { Product } from '../../core/models/product.model';
import type { Order, OrderStatus } from '../../core/models/order.model';

const EMOJI_OPTIONS: string[] = [
  '🍓', '🌸', '🍵', '🟢', '🍋', '🎂', '🥞', '🐟', '🍰', '🍙', '🧋', '🍮', '🥤',
  '🍡', '🍪', '🍩', '🧁', '🍦', '🍨', '🍯', '🍬', '🍫', '🍭', '🥧', '🫖', '☕',
];

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [ReactiveFormsModule, CurrencyPipe, DatePipe],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
})
export class AdminComponent {
  private fb = inject(FormBuilder);
  productService = inject(ProductService);
  orderService = inject(OrderService);

  activeTab = signal<'productos' | 'pedidos'>('productos');
  ordersLoadError = signal('');
  orders = toSignal(
    this.orderService.getAll().pipe(
      catchError(e => {
        this.ordersLoadError.set('❌ ' + (e.message ?? 'Error al cargar los pedidos'));
        return of([] as Order[]);
      })
    ),
    { initialValue: [] as Order[] }
  );
  orderError = signal('');
  readonly orderStatuses: OrderStatus[] = ['pendiente', 'listo', 'entregado'];

  editingId = signal<number | null>(null);
  error = signal('');
  saving = signal(false);

  readonly categories: Product['category'][] = ['mochi', 'donut', 'cake', 'drink'];
  readonly emojiOptions = EMOJI_OPTIONS;

  form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    price: [0, [Validators.required, Validators.min(0.01)]],
    description: ['', Validators.required],
    emoji: ['', Validators.required],
    category: this.fb.nonNullable.control<Product['category']>('mochi', Validators.required),
    isNew: [false],
  });

  pickEmoji(emoji: string): void {
    this.form.controls.emoji.setValue(emoji);
  }

  startEdit(product: Product): void {
    this.editingId.set(product.id);
    this.form.reset({ name: '', price: 0, description: '', emoji: '', category: 'mochi', isNew: false });
    this.form.patchValue(product);
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.form.reset({ name: '', price: 0, description: '', emoji: '', category: 'mochi', isNew: false });
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.error.set('');
    const value = this.form.getRawValue();
    try {
      const id = this.editingId();
      if (id) {
        await this.productService.update(id, value);
      } else {
        await this.productService.create(value);
      }
      this.cancelEdit();
    } catch (e: any) {
      this.error.set('❌ ' + (e.message ?? 'Error al guardar el producto'));
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
      this.error.set('❌ ' + (e.message ?? 'Error al borrar el producto'));
    }
  }

  async changeStatus(order: Order, status: OrderStatus): Promise<void> {
    this.orderError.set('');
    try {
      await this.orderService.updateStatus(order.id, status);
    } catch (e: any) {
      this.orderError.set('❌ ' + (e.message ?? 'Error al actualizar el pedido'));
    }
  }
}
