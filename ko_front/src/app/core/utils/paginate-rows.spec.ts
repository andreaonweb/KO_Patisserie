import { buildRows, columnsFor, pageCount, pageGroups } from './paginate-rows';

const range = (n: number, prefix = 'p') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

describe('columnsFor', () => {
  // Mismas cifras que el CSS de la carta: tarjetas de 250px con hueco de 26px.
  it('matches how the CSS grid fills columns', () => {
    expect(columnsFor(1000, 250, 26, 3)).toBe(3); // 3 x 250 + 2 x 26 = 802; 4 columnas no caben (1104)
    expect(columnsFor(802, 250, 26, 3)).toBe(3);
    expect(columnsFor(801, 250, 26, 3)).toBe(2);
    expect(columnsFor(1104, 250, 26, 3)).toBe(4);
  });

  it('gives one column when the container is narrower than the minimum track', () => {
    expect(columnsFor(200, 250, 26, 3)).toBe(1);
    expect(columnsFor(250, 250, 26, 3)).toBe(1);
  });

  it('uses the fallback until the width is known', () => {
    expect(columnsFor(0, 250, 26, 3)).toBe(3);
    expect(columnsFor(NaN, 250, 26, 2)).toBe(2);
  });
});

describe('buildRows', () => {
  it('splits every section into rows of its own column count, in section order', () => {
    const rows = buildRows([
      { key: 'dulces', items: range(5), columns: 3 },
      { key: 'bebidas', items: range(3, 'b'), columns: 2 },
    ]);
    expect(rows.map(r => [r.section, r.items.length])).toEqual([
      ['dulces', 3],
      ['dulces', 2],
      ['bebidas', 2],
      ['bebidas', 1],
    ]);
  });

  it('skips empty sections and never loops on a zero column count', () => {
    expect(buildRows([{ key: 'a', items: [], columns: 3 }])).toEqual([]);
    expect(buildRows([{ key: 'a', items: range(2), columns: 0 }]).length).toBe(2);
  });
});

describe('pageCount', () => {
  it('is at least one page', () => {
    expect(pageCount(0, 2)).toBe(1);
    expect(pageCount(1, 2)).toBe(1);
    expect(pageCount(2, 2)).toBe(1);
    expect(pageCount(3, 2)).toBe(2);
    expect(pageCount(5, 2)).toBe(3);
  });
});

describe('pageGroups', () => {
  const rows = buildRows([
    { key: 'dulces', items: range(8), columns: 3 }, // filas: 3, 3, 2
    { key: 'bebidas', items: range(3, 'b'), columns: 2 }, // filas: 2, 1
  ]);

  it('holds at most two rows per page', () => {
    expect(pageCount(rows.length, 2)).toBe(3);
    expect(pageGroups(rows, 1, 2)).toEqual([{ section: 'dulces', items: range(6) }]);
  });

  it('lets a page end one section and start the next, each under its own group', () => {
    expect(pageGroups(rows, 2, 2)).toEqual([
      { section: 'dulces', items: ['p7', 'p8'] },
      { section: 'bebidas', items: ['b1', 'b2'] },
    ]);
  });

  it('gives the remaining row on the last page', () => {
    expect(pageGroups(rows, 3, 2)).toEqual([{ section: 'bebidas', items: ['b3'] }]);
  });

  it('never exceeds the row limit, whatever the width', () => {
    for (const width of [300, 600, 900, 1200, 1600]) {
      const cs = columnsFor(width, 250, 26, 3);
      const cd = columnsFor(width, 380, 26, 2);
      const all = buildRows([
        { key: 'dulces', items: range(13), columns: cs },
        { key: 'bebidas', items: range(6, 'b'), columns: cd },
      ]);
      const pages = pageCount(all.length, 2);
      let seen = 0;
      for (let p = 1; p <= pages; p++) {
        const groups = pageGroups(all, p, 2);
        const sweetRows = Math.ceil((groups.find(g => g.section === 'dulces')?.items.length ?? 0) / cs);
        const drinkRows = Math.ceil((groups.find(g => g.section === 'bebidas')?.items.length ?? 0) / cd);
        expect(sweetRows + drinkRows).toBeLessThanOrEqual(2);
        seen += groups.reduce((n, g) => n + g.items.length, 0);
      }
      expect(seen).toBe(19); // no se pierde ni se repite ningún producto
    }
  });
});
