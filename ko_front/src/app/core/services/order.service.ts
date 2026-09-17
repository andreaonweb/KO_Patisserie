import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, map, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { CreateOrderInput, Order, OrderItem, OrderStatus } from '../models/order.model';

interface OrderItemApiResponse {
  product_id: number;
  name: string;
  price: number;
  quantity: number;
}

interface OrderApiResponse {
  id: number;
  user_id: number;
  items: OrderItemApiResponse[];
  total: number;
  pickup_name: string;
  pickup_phone: string;
  pickup_time: string;
  status: OrderStatus;
  created_at: string;
}

const BASE = `${environment.apiUrl}/orders`;

@Injectable({ providedIn: 'root' })
export class OrderService {
  private http = inject(HttpClient);

  async create(order: CreateOrderInput): Promise<number> {
    const response = await firstValueFrom(
      this.http.post<OrderApiResponse>(BASE, {
        items: order.items.map(i => ({ product_id: i.productId, quantity: i.quantity })),
        pickup_name: order.pickupName,
        pickup_phone: order.pickupPhone,
        pickup_time: order.pickupTime,
      })
    );
    return response.id;
  }

  getMine(): Observable<Order[]> {
    return this.http.get<OrderApiResponse[]>(BASE).pipe(map(rows => rows.map(fromApi)));
  }

  getAll(): Observable<Order[]> {
    return this.http.get<OrderApiResponse[]>(BASE).pipe(map(rows => rows.map(fromApi)));
  }

  async getById(id: number): Promise<Order | undefined> {
    try {
      const row = await firstValueFrom(this.http.get<OrderApiResponse>(`${BASE}/${id}`));
      return fromApi(row);
    } catch {
      return undefined;
    }
  }

  async updateStatus(id: number, status: OrderStatus): Promise<void> {
    await firstValueFrom(this.http.patch<OrderApiResponse>(`${BASE}/${id}/status`, { status }));
  }
}

function fromApi(row: OrderApiResponse): Order {
  return {
    id: row.id,
    userId: row.user_id,
    items: row.items.map(fromItemApi),
    total: row.total,
    pickupName: row.pickup_name,
    pickupPhone: row.pickup_phone,
    pickupTime: row.pickup_time,
    status: row.status,
    createdAt: Date.parse(row.created_at),
  };
}

function fromItemApi(item: OrderItemApiResponse): OrderItem {
  return {
    productId: item.product_id,
    name: item.name,
    price: item.price,
    quantity: item.quantity,
  };
}
