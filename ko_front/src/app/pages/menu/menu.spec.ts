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

  describe('pagination (two rows per page)', () => {
    const product = (id: number, category: Product['category'], name = `Producto ${id}`): Product => ({
      id, name, category, price: 3, description: 'x', emoji: '',
    });
    // 8 dulces + 3 bebidas. Con las columnas por defecto (3 de dulces, 2 de bebidas): 3+3+2 filas de dulces y 2+1 de bebidas.
    const load = () => {
      const service = TestBed.inject(ProductService) as unknown as FakeProductService;
      service.products.set([
        ...Array.from({ length: 8 }, (_, i) => product(i + 1, 'mochi', `Dulce ${i + 1}`)),
        ...Array.from({ length: 3 }, (_, i) => product(100 + i, 'drink', `Bebida ${i + 1}`)),
      ]);
      component.contentWidth.set(0); // sin medir: columnas por defecto
      fixture.detectChanges();
    };
    const cards = () => fixture.nativeElement.querySelectorAll('app-product-card').length;
    const headings = () =>
      (Array.from(fixture.nativeElement.querySelectorAll('.menu__section')) as HTMLElement[]).map(h => h.textContent!.trim());
    const pagerText = () => (fixture.nativeElement.querySelector('.menu__pager span') as HTMLElement | null)?.textContent?.trim();
    const pagerButton = (label: string) =>
      (Array.from(fixture.nativeElement.querySelectorAll('.menu__pager button')) as HTMLButtonElement[]).find(b =>
        b.textContent!.includes(label)
      )!;

    it('shows at most two rows on the first page', () => {
      load();
      expect(cards()).toBe(6);
      expect(headings()).toEqual(['Dulces']);
      expect(pagerText()).toBe('Página 1 de 3');
    });

    it('lets a page finish the sweets and start the drinks, each under its own heading', () => {
      load();
      component.goToPage(2);
      fixture.detectChanges();
      expect(cards()).toBe(4); // 2 dulces (fila incompleta) + 2 bebidas
      expect(headings()).toEqual(['Dulces', 'Bebidas']);
    });

    it('ends with the remaining row', () => {
      load();
      component.goToPage(3);
      fixture.detectChanges();
      expect(cards()).toBe(1);
      expect(headings()).toEqual(['Bebidas']);
      expect(pagerText()).toBe('Página 3 de 3');
    });

    it('disables Anterior on the first page and Siguiente on the last', () => {
      load();
      expect(pagerButton('Anterior').disabled).toBe(true);
      expect(pagerButton('Siguiente').disabled).toBe(false);
      pagerButton('Siguiente').click();
      pagerButton('Siguiente').click();
      fixture.detectChanges();
      expect(pagerButton('Siguiente').disabled).toBe(true);
      expect(pagerButton('Anterior').disabled).toBe(false);
    });

    it('clamps out-of-range pages', () => {
      load();
      component.goToPage(99);
      expect(component.page()).toBe(3);
      component.goToPage(-4);
      expect(component.page()).toBe(1);
    });

    it('goes back to the first page when the search or filters change', () => {
      load();
      component.goToPage(2);
      fixture.detectChanges();
      component.category.set('drink');
      fixture.detectChanges();
      expect(component.page()).toBe(1);
      expect(cards()).toBe(3);
      expect(headings()).toEqual(['Bebidas']);
    });

    it('hides the pager when everything fits in two rows', () => {
      load();
      component.category.set('drink'); // 3 bebidas en filas de 2 = 2 filas
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.menu__pager')).toBeNull();
      expect(component.pageCount()).toBe(1);
    });

    it('recomputes the pages from the measured width (narrow screens have fewer columns)', () => {
      load();
      expect(component.pageCount()).toBe(3);
      component.contentWidth.set(400); // una columna: 8 + 3 filas
      fixture.detectChanges();
      expect(component.pageCount()).toBe(6);
      expect(cards()).toBe(2);
    });

    it('keeps the current page valid when a resize leaves fewer pages', () => {
      load();
      component.contentWidth.set(400);
      component.goToPage(6);
      expect(component.page()).toBe(6);
      component.contentWidth.set(1400); // más columnas: menos páginas
      expect(component.page()).toBeLessThanOrEqual(component.pageCount());
    });

    it('labels the pager for assistive technology and announces the page politely', () => {
      load();
      expect(fixture.nativeElement.querySelector('nav.menu__pager')?.getAttribute('aria-label')).toBe('Paginación de la carta');
      expect(fixture.nativeElement.querySelector('.menu__pager span')?.getAttribute('aria-live')).toBe('polite');
    });
  });
});
