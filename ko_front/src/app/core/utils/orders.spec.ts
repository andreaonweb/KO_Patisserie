import { LiveOrderList, upsertOrder } from './orders';
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

describe('LiveOrderList', () => {
  const deferred = () => {
    let resolve!: (rows: Order[]) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<Order[]>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it('replaces the list on a normal load', async () => {
    const feed = new LiveOrderList();
    await feed.load(async () => [order(1, 100)]);
    expect(feed.orders().map(o => o.id)).toEqual([1]);
  });

  it('keeps an event applied while a load is in flight', async () => {
    const feed = new LiveOrderList();
    const d = deferred();
    const loading = feed.load(() => d.promise);
    feed.apply(order(1, 100, 'listo'));
    d.resolve([order(1, 100, 'pendiente')]);
    await loading;
    expect(feed.orders()[0].status).toBe('listo');
  });

  it('discards a stale load that resolves after a newer one', async () => {
    const feed = new LiveOrderList();
    const older = deferred();
    const newer = deferred();
    const p1 = feed.load(() => older.promise);
    const p2 = feed.load(() => newer.promise);
    newer.resolve([order(2, 200)]);
    await p2;
    older.resolve([order(1, 100)]);
    await p1;
    expect(feed.orders().map(o => o.id)).toEqual([2]);
  });

  it('leaves the list and applied events intact when a load fails, and rethrows', async () => {
    const feed = new LiveOrderList();
    const d = deferred();
    const loading = feed.load(() => d.promise);
    feed.apply(order(1, 100, 'listo'));
    d.reject(new Error('offline'));
    await expect(loading).rejects.toThrow('offline');
    expect(feed.orders().map(o => o.status)).toEqual(['listo']);
  });

  it('does not re-apply an event received outside a load', async () => {
    const feed = new LiveOrderList();
    feed.apply(order(1, 100, 'listo'));
    await feed.load(async () => [order(1, 100, 'entregado')]);
    expect(feed.orders()[0].status).toBe('entregado');
  });
});
