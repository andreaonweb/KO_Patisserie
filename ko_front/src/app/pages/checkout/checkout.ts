import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';
import { CartService } from '../../core/services/cart.service';
import { OrderService } from '../../core/services/order.service';
import type { OrderItem } from '../../core/models/order.model';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [ReactiveFormsModule, CurrencyPipe],
  templateUrl: './checkout.html',
  styleUrl: './checkout.scss',
})
export class CheckoutComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private auth = inject(AuthService);
  private orderService = inject(OrderService);
  cart = inject(CartService);

  cartItems = this.cart.getItems();
  error = signal('');
  saving = signal(false);

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

  async submit(): Promise<void> {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.error.set('');
    const items: OrderItem[] = this.cartItems().map(i => ({
      productId: String(i.product.id),
      name: i.product.name,
      price: i.product.price,
      quantity: i.quantity,
    }));
    try {
      const orderId = await this.orderService.create({
        userId: String(this.auth.currentUser()!.id),
        items,
        total: this.cart.total(),
        ...this.form.getRawValue(),
      });
      this.cart.clear();
      this.router.navigate(['/checkout/confirmacion', orderId]);
    } catch (e: any) {
      this.error.set('❌ ' + (e.message ?? 'Error al confirmar el pedido'));
    } finally {
      this.saving.set(false);
    }
  }
}
