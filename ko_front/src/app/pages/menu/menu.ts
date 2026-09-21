import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ProductCardComponent } from '../../shared/components/product-card/product-card';
import { CartService } from '../../core/services/cart.service';
import { ProductService } from '../../core/services/product.service';
import { Product } from '../../core/models/product.model';
import { buildRows, columnsFor, pageCount, pageGroups } from '../../core/utils/paginate-rows';

type CategoryFilter = '' | Product['category'];

/** Filas de productos como máximo en cada página de la carta. */
const ROWS_PER_PAGE = 2;

/** Medidas de la rejilla; al medir se leen de las variables CSS de `menu.scss`, que son la fuente de verdad. */
const DEFAULT_GRID = { card: 250, drink: 380, gap: 26 };
/** Columnas que se suponen mientras no se conoce el ancho real (antes de medir). */
const FALLBACK_COLUMNS = { sweets: 3, drinks: 2 };

const SECTION_TITLES: Record<string, string> = { dulces: 'Dulces', bebidas: 'Bebidas' };

const normalize = (v: string): string =>
  v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [ProductCardComponent],
  templateUrl: './menu.html',
  styleUrl: './menu.scss',
})
export class MenuComponent {
  cart = inject(CartService);
  productService = inject(ProductService);

  cartItems = this.cart.getItems();
  products = this.productService.products;

  readonly categories: { value: CategoryFilter; label: string }[] = [
    { value: '', label: 'Todo' },
    { value: 'mochi', label: 'Mochis' },
    { value: 'donut', label: 'Donuts' },
    { value: 'cake', label: 'Tartas' },
    { value: 'drink', label: 'Bebidas' },
  ];

  query = signal('');
  category = signal<CategoryFilter>('');
  maxPrice = signal<number | null>(null);

  filtered = computed(() => {
    const term = normalize(this.query());
    const category = this.category();
    const max = this.maxPrice();
    return this.products().filter(p =>
      (!term || normalize(p.name).includes(term) || normalize(p.description).includes(term)) &&
      (!category || p.category === category) &&
      (max === null || p.price <= max)
    );
  });

  sweets = computed(() => this.filtered().filter(p => p.category !== 'drink'));
  drinks = computed(() => this.filtered().filter(p => p.category === 'drink'));
  hasFilters = computed(() => !!this.query() || !!this.category() || this.maxPrice() !== null);

  // ── Paginación: como mucho ROWS_PER_PAGE filas por página, sea cual sea el ancho ──
  /** Ancho del contenedor de las rejillas (0 hasta que se mide). */
  contentWidth = signal(0);
  private grid = signal(DEFAULT_GRID);
  private requestedPage = signal(1);

  private sweetColumns = computed(() =>
    columnsFor(this.contentWidth(), this.grid().card, this.grid().gap, FALLBACK_COLUMNS.sweets)
  );
  private drinkColumns = computed(() =>
    columnsFor(this.contentWidth(), this.grid().drink, this.grid().gap, FALLBACK_COLUMNS.drinks)
  );

  private rows = computed(() =>
    buildRows([
      { key: 'dulces', items: this.sweets(), columns: this.sweetColumns() },
      { key: 'bebidas', items: this.drinks(), columns: this.drinkColumns() },
    ])
  );

  pageCount = computed(() => pageCount(this.rows().length, ROWS_PER_PAGE));
  page = computed(() => Math.min(this.requestedPage(), this.pageCount()));
  groups = computed(() =>
    pageGroups(this.rows(), this.page(), ROWS_PER_PAGE).map(g => ({ ...g, title: SECTION_TITLES[g.section] }))
  );

  private content = viewChild<ElementRef<HTMLElement>>('content');

  constructor() {
    // Al cambiar la búsqueda o los filtros se vuelve a la primera página.
    effect(() => {
      this.query();
      this.category();
      this.maxPrice();
      untracked(() => this.requestedPage.set(1));
    });

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.content()?.nativeElement;
      if (!el) return;
      this.readGridMetrics(el);
      this.contentWidth.set(el.clientWidth);
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => this.contentWidth.set(el.clientWidth));
      observer.observe(el);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  goToPage(n: number): void {
    this.requestedPage.set(Math.min(Math.max(1, n), this.pageCount()));
    // Al cambiar de página se vuelve al principio de la carta, respetando el movimiento reducido.
    const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.content()?.nativeElement.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  setMaxPrice(value: string): void {
    const n = parseFloat(value);
    this.maxPrice.set(Number.isFinite(n) ? n : null);
  }

  clearFilters(): void {
    this.query.set('');
    this.category.set('');
    this.maxPrice.set(null);
  }

  addToCart(product: Product): void {
    this.cart.add(product);
  }

  removeFromCart(product: Product): void {
    this.cart.remove(product.id);
  }

  private readGridMetrics(el: HTMLElement): void {
    const style = getComputedStyle(el);
    const px = (name: string, fallback: number): number => {
      const value = parseFloat(style.getPropertyValue(name));
      return Number.isFinite(value) ? value : fallback;
    };
    this.grid.set({
      card: px('--card-min', DEFAULT_GRID.card),
      drink: px('--drink-min', DEFAULT_GRID.drink),
      gap: px('--grid-gap', DEFAULT_GRID.gap),
    });
  }
}
