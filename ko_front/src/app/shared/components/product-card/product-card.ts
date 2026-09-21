import { Component, input, output, computed } from '@angular/core';
import { Product } from '../../../core/models/product.model';
import { CurrencyPipe } from '@angular/common';
import { CartItem } from '../../../core/services/cart.service';
import { ProductIconComponent } from '../product-icon/product-icon';


@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [CurrencyPipe, ProductIconComponent],
  templateUrl: './product-card.html',
  styleUrl: './product-card.scss',
})
export class ProductCardComponent {
  product = input.required<Product>();
  cartItems = input.required<CartItem[]>();
  onAdd = output<Product>();
  onRemove = output<Product>();
  compact = input(false);

  quantity = computed(() => this.cartItems().find(i => i.product.id === this.product().id)?.quantity ?? 0);
  inCart = computed(() => this.quantity() > 0);

}