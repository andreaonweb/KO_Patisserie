import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MenuComponent } from './menu';
import { ProductService } from '../../core/services/product.service';
import type { Product } from '../../core/models/product.model';

class FakeProductService {
  products = signal<Product[]>([]);
}

describe('Menu', () => {
  let component: MenuComponent;
  let fixture: ComponentFixture<MenuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MenuComponent],
      providers: [{ provide: ProductService, useClass: FakeProductService }],
    }).compileComponents();

    fixture = TestBed.createComponent(MenuComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('reads products from ProductService', () => {
    expect(component.products()).toEqual([]);
  });

  describe('sections with their own pagination (two rows per page)', () => {
    const product = (id: number, category: Product['category'], name = `Producto ${id}`): Product => ({
      id, name, category, price: 3, description: 'x', emoji: '',
    });
    // Con las columnas por defecto (3 de dulces, 2 de bebidas): dulces en páginas de 6, bebidas en páginas de 4.
    const load = (sweets = 8, drinks = 3) => {
      const service = TestBed.inject(ProductService) as unknown as FakeProductService;
      service.products.set([
        ...Array.from({ length: sweets }, (_, i) => product(i + 1, 'mochi', `Dulce ${i + 1}`)),
        ...Array.from({ length: drinks }, (_, i) => product(100 + i, 'drink', `Bebida ${i + 1}`)),
      ]);
      component.contentWidth.set(0); // sin medir: columnas por defecto
      fixture.detectChanges();
    };
    const section = (key: string) => (fixture.nativeElement as HTMLElement).querySelector(`#menu-${key}`) as HTMLElement | null;
    const cards = (key: string) => section(key)?.querySelectorAll('app-product-card').length ?? 0;
    const titles = () =>
      (Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.menu__section')) as HTMLElement[]).map(h =>
        h.childNodes[0].textContent!.trim()
      );
    const pagerText = (key: string) => (section(key)?.querySelector('.menu__pager span') as HTMLElement | null)?.textContent?.trim();
    const pagerButton = (key: string, label: string) =>
      (Array.from(section(key)!.querySelectorAll('.menu__pager button')) as HTMLButtonElement[]).find(b =>
        b.textContent!.includes(label)
      )!;

    it('shows Dulces and Bebidas as two separate sections on the same page', () => {
      load();
      expect(titles()).toEqual(['Dulces', 'Bebidas']);
      expect(cards('dulces')).toBe(6); // dos filas de 3
      expect(cards('bebidas')).toBe(3);
    });

    it('shows how many products each section has', () => {
      load(8, 1);
      expect(section('dulces')!.querySelector('.menu__count')!.textContent!.trim()).toBe('8 productos');
      expect(section('bebidas')!.querySelector('.menu__count')!.textContent!.trim()).toBe('1 producto');
    });

    it('paginates a section only when it does not fit in two rows', () => {
      load();
      expect(pagerText('dulces')).toBe('Página 1 de 2');
      expect(section('bebidas')!.querySelector('.menu__pager')).toBeNull(); // 3 bebidas caben en 2 filas de 2
    });

    it('changing the page of one section leaves the other untouched', () => {
      load(8, 9); // bebidas: páginas de 4 -> 3 páginas
      component.goToPage('bebidas', 2);
      fixture.detectChanges();
      expect(pagerText('bebidas')).toBe('Página 2 de 3');
      expect(pagerText('dulces')).toBe('Página 1 de 2');
      expect(cards('dulces')).toBe(6);

      component.goToPage('dulces', 2);
      fixture.detectChanges();
      expect(cards('dulces')).toBe(2); // el resto: 8 - 6
      expect(pagerText('bebidas')).toBe('Página 2 de 3');
    });

    it('disables Anterior on the first page and Siguiente on the last of each section', () => {
      load();
      expect(pagerButton('dulces', 'Anterior').disabled).toBe(true);
      pagerButton('dulces', 'Siguiente').click();
      fixture.detectChanges();
      expect(pagerButton('dulces', 'Siguiente').disabled).toBe(true);
      expect(pagerButton('dulces', 'Anterior').disabled).toBe(false);
    });

    it('clamps out-of-range pages', () => {
      load();
      component.goToPage('dulces', 99);
      fixture.detectChanges();
      expect(pagerText('dulces')).toBe('Página 2 de 2');
      component.goToPage('dulces', -4);
      fixture.detectChanges();
      expect(pagerText('dulces')).toBe('Página 1 de 2');
    });

    it('goes back to the first page of every section when the search or filters change', () => {
      load(8, 9);
      component.goToPage('dulces', 2);
      component.goToPage('bebidas', 3);
      fixture.detectChanges();
      component.query.set('dulce');
      fixture.detectChanges();
      expect(pagerText('dulces')).toBe('Página 1 de 2');
      expect(section('bebidas')).toBeNull(); // ninguna bebida coincide con "dulce"
    });

    it('hides a section with no results', () => {
      load();
      component.category.set('drink');
      fixture.detectChanges();
      expect(titles()).toEqual(['Bebidas']);
      expect(section('dulces')).toBeNull();
    });

    it('recomputes the pages from the measured width (narrow screens have fewer columns)', () => {
      load();
      component.contentWidth.set(400); // una columna: páginas de 2 productos
      fixture.detectChanges();
      expect(cards('dulces')).toBe(2);
      expect(pagerText('dulces')).toBe('Página 1 de 4');
      expect(pagerText('bebidas')).toBe('Página 1 de 2');
    });

    it('keeps the current page valid when a resize leaves fewer pages', () => {
      load();
      component.contentWidth.set(400);
      component.goToPage('dulces', 4);
      fixture.detectChanges();
      component.contentWidth.set(1400);
      fixture.detectChanges();
      const [current, total] = pagerText('dulces')?.match(/\d+/g)?.map(Number) ?? [1, 1];
      expect(current).toBeLessThanOrEqual(total);
    });

    it('labels each pager for assistive technology and announces the page politely', () => {
      load();
      const nav = section('dulces')!.querySelector('nav.menu__pager')!;
      expect(nav.getAttribute('aria-label')).toBe('Paginación de dulces');
      expect(nav.querySelector('span')!.getAttribute('aria-live')).toBe('polite');
    });

    it('names each section region by its heading', () => {
      load();
      const labelledBy = section('dulces')!.getAttribute('aria-labelledby')!;
      expect(fixture.nativeElement.querySelector(`#${labelledBy}`).textContent).toContain('Dulces');
    });
  });
});
