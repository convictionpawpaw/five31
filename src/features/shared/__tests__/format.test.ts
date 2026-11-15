import { describe, it, expect } from 'vitest';
import { fmtMonthYear, fmtShortDate, parseIsoForDisplay } from '../format.ts';

describe('parseIsoForDisplay — date-only strings are LOCAL calendar dates', () => {
  it('parses YYYY-MM-DD as local midnight of that day, in any timezone', () => {
    const d = parseIsoForDisplay('2026-07-01');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(0);
    expect(d.getTime()).toBe(new Date(2026, 6, 1).getTime());
  });

  it('still parses a full timestamp as an instant', () => {
    const iso = '2026-07-01T18:30:00.000Z';
    expect(parseIsoForDisplay(iso).getTime()).toBe(Date.parse(iso));
  });

  it('labels a bodyweight date as that day (west of UTC used to read JUN 30)', () => {
    expect(fmtShortDate('2026-07-01')).toBe('JUL 1');
    expect(fmtShortDate('2026-01-01')).toBe('JAN 1');
    expect(fmtMonthYear('2026-01-01')).toBe('JAN 2026');
  });

  it('falls back to the raw prefix for an unparseable string', () => {
    expect(fmtShortDate('not-a-date')).toBe('not-a-date');
  });
});
