import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import { CartService } from '../../core/services/cart.service';
import { ProductIconComponent } from '../../shared/components/product-icon/product-icon';
import { OrderService } from '../../core/services/order.service';
import { availableDays, slotsForDay } from '../../core/utils/pickup-slots';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [ReactiveFormsModule, CurrencyPipe, ProductIconComponent],
  templateUrl: './checkout.html',
  styleUrl: './checkout.scss',
})
export class CheckoutComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private orderService = inject(OrderService);
  cart = inject(CartService);

  cartItems = this.cart.getItems();
  error = signal('');
  saving = signal(false);

  pickupDays = availableDays();
  selectedDay = signal(this.pickupDays[0]?.value ?? '');
  pickupSlots = computed(() => slotsForDay(this.selectedDay()));

  form = this.fb.nonNullable.group({
    pickupName: ['', Validators.required],
    pickupPhone: ['', Validators.required],
    pickupTime: ['', Validators.required],
  });

  ngOnInit(): void {
    if (this.cart.itemCount() === 0) {
      this.router.navigate(['/menu']);
    }
  }

  selectDay(day: string): void {
    this.selectedDay.set(day);
    this.form.controls.pickupTime.reset('');
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.error.set('');
    const items = this.cartItems().map(i => ({
      productId: i.product.id,
      quantity: i.quantity,
    }));
    try {
      const orderId = await this.orderService.create({
        items,
        ...this.form.getRawValue(),
      });
      this.cart.clear();
      this.router.navigate(['/checkout/confirmacion', orderId]);
    } catch (e: any) {
      this.error.set((e.message ?? 'Error al confirmar el pedido'));
    } finally {
      this.saving.set(false);
    }
  }
}
