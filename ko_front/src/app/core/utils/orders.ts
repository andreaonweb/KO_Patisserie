import type { Order } from '../models/order.model';

/** Reemplaza un pedido por id, o lo añade; siempre del más reciente al más antiguo. */
export function upsertOrder(list: Order[], order: Order): Order[] {
  const next = list.some(o => o.id === order.id) ? list.map(o => (o.id === order.id ? order : o)) : [order, ...list];
  return next.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
}
