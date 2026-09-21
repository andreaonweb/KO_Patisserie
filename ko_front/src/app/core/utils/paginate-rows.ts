/**
 * Paginación por filas de una rejilla responsive.
 *
 * Como el número de columnas depende del ancho, "dos filas por página" no equivale a un número fijo de
 * elementos: primero se reparte cada sección en filas de N columnas y luego se agrupan las filas en páginas.
 */

export interface Section<T> {
  key: string;
  items: T[];
  /** Columnas que caben ahora mismo en la rejilla de esta sección. */
  columns: number;
}

export interface Row<T> {
  section: string;
  items: T[];
}

/** Filas consecutivas de una misma sección dentro de una página (se pintan bajo un mismo título). */
export interface RowGroup<T> {
  section: string;
  items: T[];
}

/**
 * Columnas de una rejilla `repeat(auto-fill, minmax(min(100%, minTrack), 1fr))` con hueco `gap`.
 * Devuelve `fallback` mientras no se conozca el ancho (antes de medir, o fuera del navegador).
 */
export function columnsFor(width: number, minTrack: number, gap: number, fallback: number): number {
  if (!(width > 0)) return fallback;
  const track = Math.min(minTrack, width);
  return Math.max(1, Math.floor((width + gap) / (track + gap)));
}

/** Reparte cada sección en filas de `columns` elementos, conservando el orden de las secciones. */
export function buildRows<T>(sections: Section<T>[]): Row<T>[] {
  const rows: Row<T>[] = [];
  for (const { key, items, columns } of sections) {
    const size = Math.max(1, columns);
    for (let i = 0; i < items.length; i += size) {
      rows.push({ section: key, items: items.slice(i, i + size) });
    }
  }
  return rows;
}

export function pageCount(rowCount: number, rowsPerPage: number): number {
  return Math.max(1, Math.ceil(rowCount / Math.max(1, rowsPerPage)));
}

/** Filas de la página `page` (empieza en 1), agrupadas por sección consecutiva. */
export function pageGroups<T>(rows: Row<T>[], page: number, rowsPerPage: number): RowGroup<T>[] {
  const size = Math.max(1, rowsPerPage);
  const slice = rows.slice((page - 1) * size, page * size);
  const groups: RowGroup<T>[] = [];
  for (const row of slice) {
    const last = groups[groups.length - 1];
    if (last && last.section === row.section) last.items.push(...row.items);
    else groups.push({ section: row.section, items: [...row.items] });
  }
  return groups;
}
