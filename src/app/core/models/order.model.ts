export type OrderStatus = 'pendiente' | 'listo' | 'entregado';

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  total: number;
  pickupName: string;
  pickupPhone: string;
  pickupTime: string;
  status: OrderStatus;
  createdAt: number;
}
