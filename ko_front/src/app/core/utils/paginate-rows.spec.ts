import { columnsFor, pageCount, pageItems, pageSize } from './paginate-rows';

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

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

describe('pageSize / pageCount', () => {
  it('a page holds rows x columns items', () => {
    expect(pageSize(4, 2)).toBe(8);
    expect(pageSize(1, 2)).toBe(2);
  });

  it('never divides by zero', () => {
    expect(pageSize(0, 2)).toBe(2);
    expect(pageSize(3, 0)).toBe(3);
  });

  it('counts pages, with at least one even when empty', () => {
    expect(pageCount(0, 3, 2)).toBe(1);
    expect(pageCount(6, 3, 2)).toBe(1);
    expect(pageCount(7, 3, 2)).toBe(2);
    expect(pageCount(13, 4, 2)).toBe(2);
    expect(pageCount(13, 1, 2)).toBe(7);
  });
});

describe('pageItems', () => {
  it('returns the slice for each page, ending with the remainder', () => {
    const items = range(13);
    expect(pageItems(items, 1, 4, 2)).toEqual(range(8));
    expect(pageItems(items, 2, 4, 2)).toEqual([9, 10, 11, 12, 13]);
    expect(pageItems(items, 3, 4, 2)).toEqual([]);
  });

  it('never shows more than two rows and never loses or repeats an item, whatever the width', () => {
    for (const width of [300, 600, 900, 1200, 1600]) {
      const columns = columnsFor(width, 250, 26, 3);
      const items = range(23);
      const pages = pageCount(items.length, columns, 2);
      const seen: number[] = [];
      for (let p = 1; p <= pages; p++) {
        const shown = pageItems(items, p, columns, 2);
        expect(Math.ceil(shown.length / columns)).toBeLessThanOrEqual(2);
        seen.push(...shown);
      }
      expect(seen).toEqual(items);
    }
  });
});
