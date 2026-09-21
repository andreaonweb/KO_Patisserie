/**
 * Paginación por filas de una rejilla responsive.
 *
 * Como el número de columnas depende del ancho, "dos filas por página" no equivale a un número fijo de
 * elementos: se calcula a partir de las columnas que caben en cada momento.
 */

/**
 * Columnas de una rejilla `repeat(auto-fill, minmax(min(100%, minTrack), 1fr))` con hueco `gap`.
 * Devuelve `fallback` mientras no se conozca el ancho (antes de medir, o fuera del navegador).
 */
export function columnsFor(width: number, minTrack: number, gap: number, fallback: number): number {
  if (!(width > 0)) return fallback;
  const track = Math.min(minTrack, width);
  return Math.max(1, Math.floor((width + gap) / (track + gap)));
}

/** Elementos que caben en una página de `rowsPerPage` filas de `columns` columnas. */
export function pageSize(columns: number, rowsPerPage: number): number {
  return Math.max(1, columns) * Math.max(1, rowsPerPage);
}

/** Número de páginas (siempre al menos una) para `total` elementos. */
export function pageCount(total: number, columns: number, rowsPerPage: number): number {
  return Math.max(1, Math.ceil(total / pageSize(columns, rowsPerPage)));
}

/** Elementos de la página `page` (empieza en 1). */
export function pageItems<T>(items: T[], page: number, columns: number, rowsPerPage: number): T[] {
  const size = pageSize(columns, rowsPerPage);
  return items.slice((page - 1) * size, page * size);
}
