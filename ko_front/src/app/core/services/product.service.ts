import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Firestore, collection, collectionData, doc, addDoc, updateDoc, deleteDoc } from '@angular/fire/firestore';
import type { Observable } from 'rxjs';
import { Product } from '../models/product.model';

const COLLECTION = 'products';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private firestore = inject(Firestore);
  private productsRef = collection(this.firestore, COLLECTION);

  products = toSignal(
    collectionData(this.productsRef, { idField: 'id' }) as Observable<Product[]>,
    { initialValue: [] as Product[] }
  );

  async create(product: Omit<Product, 'id'>): Promise<void> {
    await addDoc(this.productsRef, product);
  }

  async update(id: string, changes: Omit<Product, 'id'>): Promise<void> {
    await updateDoc(doc(this.productsRef, id), changes);
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(doc(this.productsRef, id));
  }

  async seedIfEmpty(products: Omit<Product, 'id'>[]): Promise<void> {
    if (this.products().length > 0) return;
    for (const product of products) {
      await addDoc(this.productsRef, product);
    }
  }
}
