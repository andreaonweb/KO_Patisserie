import { Component, computed, inject, signal } from '@angular/core';
import { ProductCardComponent } from '../../shared/components/product-card/product-card';
import { CartService } from '../../core/services/cart.service';
import { ProductService } from '../../core/services/product.service';
import { Product } from '../../core/models/product.model';

type CategoryFilter = '' | Product['category'];

const normalize = (v: string): string =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [ProductCardComponent],
  templateUrl: './menu.html',
  styleUrl: './menu.scss',
})
export class MenuComponent {
  cart = inject(CartService);
  productService = inject(ProductService);

  cartItems = this.cart.getItems();
  products = this.productService.products;

  readonly categories: { value: CategoryFilter; label: string }[] = [
    { value: '', label: 'Todo' },
    { value: 'mochi', label: 'Mochis' },
    { value: 'donut', label: 'Donuts' },
    { value: 'cake', label: 'Tartas' },
    { value: 'drink', label: 'Bebidas' },
  ];

  query = signal('');
  category = signal<CategoryFilter>('');
  maxPrice = signal<number | null>(null);

  filtered = computed(() => {
    const term = normalize(this.query());
    const category = this.category();
    const max = this.maxPrice();
    return this.products().filter(p =>
      (!term || normalize(p.name).includes(term) || normalize(p.description).includes(term)) &&
      (!category || p.category === category) &&
      (max === null || p.price <= max)
    );
  });

  sweets = computed(() => this.filtered().filter(p => p.category !== 'drink'));
  drinks = computed(() => this.filtered().filter(p => p.category === 'drink'));
  hasFilters = computed(() => !!this.query() || !!this.category() || this.maxPrice() !== null);

  setMaxPrice(value: string): void {
    const n = parseFloat(value);
    this.maxPrice.set(Number.isFinite(n) ? n : null);
  }

  clearFilters(): void {
    this.query.set('');
    this.category.set('');
    this.maxPrice.set(null);
  }

  addToCart(product: Product): void {
    this.cart.add(product);
  }

  removeFromCart(product: Product): void {
    this.cart.remove(product.id);
  }
}
