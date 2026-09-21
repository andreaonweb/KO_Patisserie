import { signal } from '@angular/core';
import type { Order } from '../models/order.model';

/** Reemplaza un pedido por id, o lo añade; siempre del más reciente al más antiguo. */
export function upsertOrder(list: Order[], order: Order): Order[] {
  const next = list.some(o => o.id === order.id) ? list.map(o => (o.id === order.id ? order : o)) : [order, ...list];
  return next.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
}

/** Lista de pedidos en vivo: los eventos recibidos durante una carga se reaplican sobre su resultado. */
export class LiveOrderList {
  readonly orders = signal<Order[]>([]);
  private seq = 0;
  private loading = false;
  private buffer: Order[] = [];

  apply(order: Order): void {
    this.orders.update(l => upsertOrder(l, order));
    if (this.loading) this.buffer.push(order);
  }

  async load(fetch: () => Promise<Order[]>): Promise<void> {
    const id = ++this.seq;
    this.loading = true;
    this.buffer = [];
    let rows: Order[];
    try {
      rows = await fetch();
    } catch (e) {
      if (id === this.seq) this.loading = false;
      throw e;
    }
    if (id !== this.seq) return;
    this.orders.set(this.buffer.reduce(upsertOrder, rows));
    this.buffer = [];
    this.loading = false;
  }
}
