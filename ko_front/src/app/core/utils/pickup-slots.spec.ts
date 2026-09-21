import { availableDays, formatPickupTime, slotsForDay } from './pickup-slots';

// 2026-09-21 es lunes; 2026-09-22 martes; 2026-09-26 sábado.
const at = (iso: string): Date => new Date(iso);

describe('pickup slots', () => {
  it('has no slots on Mondays', () => {
    expect(slotsForDay('2026-09-21', at('2026-09-20T10:00:00'))).toEqual([]);
  });

  it('lists every 30-minute slot from opening to the last one before closing', () => {
    const slots = slotsForDay('2026-09-22', at('2026-09-20T10:00:00')); // martes 8:30–20:00
    expect(slots[0]).toBe('08:30');
    expect(slots.at(-1)).toBe('19:30');
    expect(slots).toHaveLength(23);
  });

  it('uses weekend hours', () => {
    const slots = slotsForDay('2026-09-26', at('2026-09-20T10:00:00')); // sábado 9:00–21:00
    expect(slots[0]).toBe('09:00');
    expect(slots.at(-1)).toBe('20:30');
  });

  it('drops today’s slots that do not leave the minimum lead time', () => {
    const slots = slotsForDay('2026-09-22', at('2026-09-22T12:10:00'));
    expect(slots[0]).toBe('13:00'); // 12:10 + 30 min = 12:40 → primer tramo posible 13:00
  });

  it('offers only the days that still have slots, skipping Mondays', () => {
    const days = availableDays(at('2026-09-21T10:00:00')); // lunes
    expect(days[0].value).toBe('2026-09-22');
    expect(days.map(d => d.value)).not.toContain('2026-09-28');
    expect(days[0].label).toBe('Mañana');
  });

  it('skips today once the shop can no longer serve a pickup', () => {
    const days = availableDays(at('2026-09-22T19:45:00')); // martes tarde
    expect(days[0].value).toBe('2026-09-23');
  });

  it('formats ISO pickup times and keeps legacy free text untouched', () => {
    expect(formatPickupTime('2026-09-22T18:00')).toBe('Martes, 22 sept · 18:00');
    expect(formatPickupTime('Hoy 18:00')).toBe('Hoy 18:00');
  });
});
