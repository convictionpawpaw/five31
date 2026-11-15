import { describe, it, expect } from 'vitest';
import { addDays, computeStreak, dayNumber, dayString } from '../streak.ts';

const s = (date: string, actualSec = 300) => ({ date, actualSec });

describe('day arithmetic', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29'); // leap year
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('never skips or repeats a day across DST changes', () => {
    // US DST: 2026-03-08 (spring forward) and 2026-11-01 (fall back);
    // EU: 2026-03-29 and 2026-10-25.
    for (const d of ['2026-03-07', '2026-03-28', '2026-10-24', '2026-10-31']) {
      const next = addDays(d, 1);
      const after = addDays(d, 2);
      expect(dayNumber(next)! - dayNumber(d)!).toBe(1);
      expect(dayNumber(after)! - dayNumber(next)!).toBe(1);
    }
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
  });

  it('rejects malformed and impossible days', () => {
    expect(dayNumber('2026-2-3')).toBeNull();
    expect(dayNumber('2026-02-30')).toBeNull();
    expect(dayNumber('nope')).toBeNull();
    expect(dayString(dayNumber('2026-07-05')!)).toBe('2026-07-05');
  });
});

describe('computeStreak', () => {
  it('is all zeros with no sessions', () => {
    const r = computeStreak([], '2026-07-05');
    expect(r.current).toBe(0);
    expect(r.longest).toBe(0);
    expect(r.doneToday).toBe(false);
    expect(r.atRisk).toBe(false);
    expect(r.totalSessions).toBe(0);
    expect(r.totalMinutes).toBe(0);
    expect(r.calendar).toHaveLength(35);
  });

  it('counts consecutive days ending today', () => {
    const r = computeStreak([s('2026-07-03'), s('2026-07-04'), s('2026-07-05')], '2026-07-05');
    expect(r.current).toBe(3);
    expect(r.doneToday).toBe(true);
    expect(r.atRisk).toBe(false);
  });

  it('keeps a streak that ended yesterday alive but at risk', () => {
    const r = computeStreak([s('2026-07-03'), s('2026-07-04')], '2026-07-05');
    expect(r.current).toBe(2);
    expect(r.doneToday).toBe(false);
    expect(r.atRisk).toBe(true);
  });

  it('is STRICT: one missed day resets it', () => {
    const r = computeStreak([s('2026-07-01'), s('2026-07-02'), s('2026-07-04')], '2026-07-06');
    expect(r.current).toBe(0);
    expect(r.atRisk).toBe(false);
    expect(r.longest).toBe(2);
    // Missing yesterday but done today: the run restarts at 1.
    const r2 = computeStreak([s('2026-07-03'), s('2026-07-05')], '2026-07-05');
    expect(r2.current).toBe(1);
  });

  it('counts multiple sessions in one day once for the streak', () => {
    const r = computeStreak(
      [s('2026-07-05', 300), s('2026-07-05', 420), s('2026-07-04', 360)],
      '2026-07-05',
    );
    expect(r.current).toBe(2);
    expect(r.longest).toBe(2);
    expect(r.totalSessions).toBe(3);
    expect(r.totalMinutes).toBe(18);
    expect(r.calendar.find((d) => d.date === '2026-07-05')!.count).toBe(2);
  });

  it('runs across month and year boundaries', () => {
    const days = ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'];
    const r = computeStreak(
      days.map((d) => s(d)),
      '2027-01-02',
    );
    expect(r.current).toBe(4);
    expect(r.longest).toBe(4);
    const feb = ['2028-02-28', '2028-02-29', '2028-03-01'];
    expect(
      computeStreak(
        feb.map((d) => s(d)),
        '2028-03-01',
      ).current,
    ).toBe(3);
  });

  it('runs across DST-change days', () => {
    const days = [
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ];
    const r = computeStreak(
      days.map((d) => s(d)),
      '2026-11-02',
    );
    expect(r.current).toBe(3);
    expect(r.longest).toBe(3);
  });

  it('finds the longest run anywhere in history, in any input order', () => {
    const days = [
      '2026-06-10',
      '2026-06-01',
      '2026-06-03',
      '2026-06-02',
      '2026-06-04',
      '2026-06-11',
    ];
    const r = computeStreak(
      days.map((d) => s(d)),
      '2026-07-01',
    );
    expect(r.longest).toBe(4);
    expect(r.current).toBe(0);
  });

  it('ignores malformed dates', () => {
    const r = computeStreak([s('bad'), s('2026-07-05')], '2026-07-05');
    expect(r.current).toBe(1);
    expect(r.totalSessions).toBe(1);
  });

  it('builds a Monday-first 5-week calendar ending on this Sunday', () => {
    // 2026-07-08 is a Wednesday.
    const r = computeStreak([s('2026-07-06'), s('2026-07-08'), s('2026-06-01')], '2026-07-08');
    expect(r.calendar[0]!.date).toBe('2026-06-08'); // Monday four weeks earlier
    expect(r.calendar[34]!.date).toBe('2026-07-12'); // Sunday
    const today = r.calendar.find((d) => d.isToday)!;
    expect(today.date).toBe('2026-07-08');
    expect(r.calendar.filter((d) => d.isFuture).map((d) => d.date)).toEqual([
      '2026-07-09',
      '2026-07-10',
      '2026-07-11',
      '2026-07-12',
    ]);
    expect(r.sessionsThisWeek).toBe(2);
  });

  it('a Sunday today puts today in the last cell; Monday in the first of the last row', () => {
    const sun = computeStreak([], '2026-07-12');
    expect(sun.calendar[34]!.isToday).toBe(true);
    const mon = computeStreak([s('2026-07-12')], '2026-07-13');
    expect(mon.calendar[28]!.isToday).toBe(true);
    expect(mon.sessionsThisWeek).toBe(0); // Sunday belonged to last week
  });

  it('treats non-finite or negative actualSec as zero minutes', () => {
    const r = computeStreak(
      [
        s('2026-07-05', Number.NaN),
        s('2026-07-04', Infinity),
        s('2026-07-03', -60),
        s('2026-07-02', 120),
      ],
      '2026-07-05',
    );
    expect(r.totalMinutes).toBe(2);
    expect(Number.isFinite(r.totalMinutes)).toBe(true);
    expect(r.totalSessions).toBe(4);
    expect(r.current).toBe(4);
  });

  it('ignores sessions dated after today for every figure', () => {
    const r = computeStreak(
      [s('2026-07-04'), s('2026-07-06'), s('2026-07-07'), s('2026-07-08'), s('2026-07-09')],
      '2026-07-05',
    );
    // Only 07-04 counts: yesterday, so the streak is 1 and at risk.
    expect(r.current).toBe(1);
    expect(r.atRisk).toBe(true);
    expect(r.doneToday).toBe(false);
    expect(r.longest).toBe(1);
    expect(r.totalSessions).toBe(1);
    expect(r.calendar.filter((d) => d.isFuture).every((d) => d.count === 0)).toBe(true);
  });

  it('throws on an invalid today', () => {
    expect(() => computeStreak([], '07/05/2026')).toThrow();
  });
});
