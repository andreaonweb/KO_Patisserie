import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Product } from '../models/product.model';

interface ProductApiResponse {
  id: number;
  name: string;
  price: number;
  description: string;
  emoji: string;
  image_url?: string | null;
  category: Product['category'];
  is_new: boolean;
  created_at: string;
}

const BASE = `${environment.apiUrl}/products`;

@Injectable({ providedIn: 'root' })
export class ProductService {
  private http = inject(HttpClient);

  products = signal<Product[]>([]);

  constructor() {
    void this.load();
  }

  async create(product: Omit<Product, 'id'>): Promise<void> {
    await firstValueFrom(this.http.post<ProductApiResponse>(BASE, toApiBody(product)));
    await this.load();
  }

  async update(id: number, changes: Omit<Product, 'id'>): Promise<void> {
    await firstValueFrom(this.http.put<ProductApiResponse>(`${BASE}/${id}`, toApiBody(changes)));
    await this.load();
  }

  async remove(id: number): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`${BASE}/${id}`));
    await this.load();
  }

  /** Sube una foto (solo admin) y devuelve su ruta pública, lista para guardarla en el producto. */
  async uploadImage(file: File): Promise<string> {
    const body = new FormData();
    body.append('file', file);
    const res = await firstValueFrom(this.http.post<{ url: string }>(`${environment.apiUrl}/uploads/products`, body));
    return toPublicUrl(res.url);
  }

  private async load(): Promise<void> {
    const rows = await firstValueFrom(this.http.get<ProductApiResponse[]>(BASE));
    this.products.set(rows.map(fromApi));
  }
}

function fromApi(row: ProductApiResponse): Product {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    description: row.description,
    emoji: row.emoji,
    imageUrl: row.image_url ? toPublicUrl(row.image_url) : null,
    category: row.category,
    isNew: row.is_new,
  };
}

function toApiBody(product: Omit<Product, 'id'>): Record<string, unknown> {
  return {
    name: product.name,
    price: product.price,
    description: product.description,
    emoji: product.emoji,
    image_url: product.imageUrl ? toStoredUrl(product.imageUrl) : null,
    category: product.category,
    is_new: product.isNew ?? false,
  };
}

/** Las fotos subidas viven en la API: se guardan como ruta relativa y en el front se sirven con su host. */
function toPublicUrl(url: string): string {
  return url.startsWith('/uploads/') ? `${environment.apiUrl}${url}` : url;
}

function toStoredUrl(url: string): string {
  return url.startsWith(`${environment.apiUrl}/uploads/`) ? url.slice(environment.apiUrl.length) : url;
}
