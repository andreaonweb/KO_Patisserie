import { upsertOrder } from './orders';
import type { Order } from '../models/order.model';

const order = (id: number, createdAt: number, status: Order['status'] = 'pendiente'): Order => ({
  id,
  userId: 1,
  items: [],
  total: 0,
  pickupName: 'Ana',
  pickupPhone: '600',
  pickupTime: '2026-09-22T18:00',
  status,
  createdAt,
});

describe('upsertOrder', () => {
  it('replaces an existing order in place', () => {
    const list = [order(2, 200), order(1, 100)];
    const next = upsertOrder(list, order(1, 100, 'listo'));
    expect(next.map(o => o.id)).toEqual([2, 1]);
    expect(next[1].status).toBe('listo');
  });

  it('adds a new order and keeps the newest first', () => {
    const next = upsertOrder([order(1, 100)], order(2, 200));
    expect(next.map(o => o.id)).toEqual([2, 1]);
  });

  it('breaks ties by id and does not mutate the input', () => {
    const list = [order(1, 100)];
    const next = upsertOrder(list, order(2, 100));
    expect(next.map(o => o.id)).toEqual([2, 1]);
    expect(list).toHaveLength(1);
  });
});
