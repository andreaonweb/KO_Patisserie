import { routes } from './app.routes';

describe('routes', () => {
  it('give every page its own title (WCAG 2.4.2)', () => {
    const pages = routes.filter(r => r.loadComponent);
    expect(pages.length).toBeGreaterThan(0);
    for (const route of pages) {
      expect(route.title, `route "${route.path}"`).toEqual(expect.stringContaining('KŌ Pâtisserie'));
    }
    const titles = pages.map(r => r.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
