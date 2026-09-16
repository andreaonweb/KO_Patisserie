import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  query,
  where,
  orderBy,
  collectionData,
} from '@angular/fire/firestore';
import type { Observable } from 'rxjs';
import type { Order, OrderStatus } from '../models/order.model';

const COLLECTION = 'orders';

@Injectable({ providedIn: 'root' })
export class OrderService {
  private firestore = inject(Firestore);
  private ordersRef = collection(this.firestore, COLLECTION);

  async create(order: Omit<Order, 'id' | 'status' | 'createdAt'>): Promise<string> {
    const docRef = await addDoc(this.ordersRef, {
      ...order,
      status: 'pendiente' as OrderStatus,
      createdAt: Date.now(),
    });
    return docRef.id;
  }

  watchByUser(userId: string): Observable<Order[]> {
    const q = query(this.ordersRef, where('userId', '==', userId), orderBy('createdAt', 'desc'));
    return collectionData(q, { idField: 'id' }) as Observable<Order[]>;
  }

  watchAll(): Observable<Order[]> {
    const q = query(this.ordersRef, orderBy('createdAt', 'desc'));
    return collectionData(q, { idField: 'id' }) as Observable<Order[]>;
  }

  async getById(id: string): Promise<Order | undefined> {
    const snap = await getDoc(doc(this.ordersRef, id));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as Order) : undefined;
  }

  async updateStatus(id: string, status: OrderStatus): Promise<void> {
    await updateDoc(doc(this.ordersRef, id), { status });
  }
}
