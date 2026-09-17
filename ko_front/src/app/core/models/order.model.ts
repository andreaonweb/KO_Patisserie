export type OrderStatus = 'pendiente' | 'listo' | 'entregado';

export interface OrderItem {
  productId: number;
  name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: number;
  userId: number;
  items: OrderItem[];
  total: number;
  pickupName: string;
  pickupPhone: string;
  pickupTime: string;
  status: OrderStatus;
  createdAt: number;
}

export interface CreateOrderInput {
  items: { productId: number; quantity: number }[];
  pickupName: string;
  pickupPhone: string;
  pickupTime: string;
}
