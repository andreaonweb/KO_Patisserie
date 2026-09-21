import { EMPTY, Observable, catchError, filter, fromEvent, interval, merge, of, switchMap } from 'rxjs';

/** Cada cuánto se vuelve a consultar mientras la página está abierta. */
export const POLL_MS = 10_000;

/**
 * Consulta de inmediato y luego cada `periodMs`, pero solo con la pestaña visible; al volver a ella
 * refresca al momento. Si una consulta falla se avisa con `onError` y se sigue intentando, así que
 * quien consuma el flujo conserva los últimos datos buenos.
 */
export function pollWhileVisible<T>(
  fetch: () => Observable<T>,
  onError: (error: { message?: string }) => void,
  periodMs = POLL_MS
): Observable<T> {
  return merge(of(0), interval(periodMs), fromEvent(document, 'visibilitychange')).pipe(
    filter(() => !document.hidden),
    switchMap(() =>
      fetch().pipe(
        catchError(e => {
          onError(e);
          return EMPTY;
        })
      )
    )
  );
}
