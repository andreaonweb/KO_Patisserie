import { Component, input, output, computed } from '@angular/core';
import { Product } from '../../../core/models/product.model';
import { CurrencyPipe } from '@angular/common';
import { CartItem } from '../../../core/services/cart.service';


@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [CurrencyPipe],
  templateUrl: './product-card.html',
  styleUrl: './product-card.scss',
})
export class ProductCardComponent {
  product = input.required<Product>();
  cartItems = input.required<CartItem[]>();
  onAdd = output<Product>();
  onRemove = output<Product>();

  inCart = computed(() => this.cartItems().some(i => i.product.id === this.product().id));

}