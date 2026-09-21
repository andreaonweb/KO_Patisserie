import { Component, computed, input } from '@angular/core';
import { LucideAngularModule, Cookie, Donut, CakeSlice, Coffee } from 'lucide-angular';
import type { Product } from '../../../core/models/product.model';

const ICONS = {
  mochi: Cookie,
  donut: Donut,
  cake: CakeSlice,
  drink: Coffee,
} as const;

/** Foto del producto si existe; si no, un icono según su categoría. */
@Component({
  selector: 'app-product-icon',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    @if (imageUrl()) {
      <img [src]="imageUrl()" alt="" [style.width.px]="frame()" [style.height.px]="frame()" />
    } @else {
      <lucide-icon [name]="icon()" [size]="size()" [strokeWidth]="1.4" aria-hidden="true" />
    }
  `,
  styles: [`
    :host { display: inline-flex; }
    img { object-fit: cover; display: block; }
  `],
})
export class ProductIconComponent {
  category = input.required<Product['category']>();
  imageUrl = input<string | null | undefined>(null);
  size = input(28);
  frame = input(48);
  icon = computed(() => ICONS[this.category()] ?? Cookie);
}
