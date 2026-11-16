import { describe, expect, it } from 'vitest';
import { recentModeCounts, shiftIsoDate } from '../modeStats.ts';

describe('recentModeCounts', () => {
  it('shifts dates across month and year ends', () => {
    expect(shiftIsoDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftIsoDate('2026-01-05', -29)).toBe('2025-12-07');
  });

  it('counts the last 30 days per mode, older sessions as focused', () => {
    const today = '2026-11-16';
    const counts = recentModeCounts(
      [
        { date: '2026-10-18' }, // 30th day counting today (included)
        { date: '2026-10-17', mode: 'midday' }, // 31st day (excluded)
        { date: '2026-11-16', mode: 'winddown' },
        { date: '2026-11-15', mode: 'winddown' },
        { date: '2026-11-10', mode: 'warmup' },
      ],
      today,
    );
    expect(counts).toEqual([
      { mode: 'warmup', count: 1 },
      { mode: 'winddown', count: 2 },
      { mode: 'focus', count: 1 },
    ]);
  });
});
