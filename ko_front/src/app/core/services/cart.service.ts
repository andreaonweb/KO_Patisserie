import { Injectable, signal, computed, effect } from '@angular/core';
import { Product } from '../models/product.model';

export interface CartItem {
  product: Product;
  quantity: number;
}

const CART_KEY = 'shirayuki_cart';

@Injectable({ providedIn: 'root' })
export class CartService {
  private items = signal<CartItem[]>(this.loadFromStorage());

  itemCount = computed(() => this.items().reduce((sum, i) => sum + i.quantity, 0));
  total = computed(() => this.items().reduce((sum, i) => sum + i.product.price * i.quantity, 0));

  constructor() {
    effect(() => {
      localStorage.setItem(CART_KEY, JSON.stringify(this.items()));
    });
  }

  private loadFromStorage(): CartItem[] {
    try {
      const stored = localStorage.getItem(CART_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  getItems() {
    return this.items.asReadonly();
  }

  add(product: Product): void {
    this.items.update(list => {
      const existing = list.find(i => i.product.id === product.id);
      if (existing) {
        return list.map(i => i.product.id === product.id
          ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...list, { product, quantity: 1 }];
    });
  }

  remove(id: string): void {
    this.items.update(list => {
      const existing = list.find(i => i.product.id === id);
      if (!existing) return list;
      if (existing.quantity === 1) return list.filter(i => i.product.id !== id);
      return list.map(i => i.product.id === id
        ? { ...i, quantity: i.quantity - 1 } : i);
    });
  }

  removeAll(id: string): void {
    this.items.update(list => list.filter(i => i.product.id !== id));
  }

  clear(): void {
    this.items.set([]);
  }
}