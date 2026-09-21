/** Horario de la tienda; debe coincidir con ko_back/app/core/pickup.py y con el footer. */
const HOURS: Record<number, [string, string]> = {
  2: ['08:30', '20:00'],
  3: ['08:30', '20:00'],
  4: ['08:30', '20:00'],
  5: ['08:30', '20:00'],
  6: ['09:00', '21:00'],
  0: ['09:00', '21:00'],
}; // getDay(): domingo = 0 … sábado = 6; el lunes (1) está cerrado

export const SLOT_MINUTES = 30;
/** Antelación mínima para preparar un pedido. */
export const LEAD_MINUTES = 30;
const DAYS_AHEAD = 7;

export interface PickupDay {
  value: string; // AAAA-MM-DD
  label: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const dateKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function parseDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Tramos de retiro (HH:MM) de un día, ya sin los que no llegan con la antelación mínima. */
export function slotsForDay(dayKey: string, now: Date = new Date()): string[] {
  const day = parseDate(dayKey);
  const hours = HOURS[day.getDay()];
  if (!hours) return [];

  const earliest = dayKey === dateKey(now) ? now.getHours() * 60 + now.getMinutes() + LEAD_MINUTES : 0;
  const slots: string[] = [];
  for (let m = toMinutes(hours[0]); m <= toMinutes(hours[1]) - SLOT_MINUTES; m += SLOT_MINUTES) {
    if (m >= earliest) slots.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  return slots;
}

/** Próximos días con al menos un tramo disponible, con etiqueta legible. */
export function availableDays(now: Date = new Date()): PickupDay[] {
  const fmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
  const days: PickupDay[] = [];
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const value = dateKey(d);
    if (slotsForDay(value, now).length === 0) continue;
    const text = fmt.format(d);
    const label = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : text.charAt(0).toUpperCase() + text.slice(1);
    days.push({ value, label });
  }
  return days;
}

/** "2026-09-22T18:00" → "Martes 22 sep · 18:00". Los valores antiguos de texto libre se dejan tal cual. */
export function formatPickupTime(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (!match) return value;
  const text = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'short' }).format(parseDate(match[1]));
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} · ${match[2]}`;
}
