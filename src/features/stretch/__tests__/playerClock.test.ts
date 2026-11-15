import { describe, it, expect } from 'vitest';
import {
  catchUpClock,
  freezeClock,
  hideClock,
  pauseClock,
  pausedClock,
  readClock,
  resumeClock,
  seekClock,
  startClock,
} from '../playerClock.ts';
import { buildTimeline, locate } from '../playerTimeline.ts';
import { armAutostart, clearAutostart, isAutostartFresh } from '../playerLaunch.ts';
import { msUntilNextLocalDay } from '../useToday.ts';

const TOTAL = 60_000;
const T0 = 1_000_000;

describe('player clock', () => {
  it('runs from a start timestamp and reads elapsed/active', () => {
    const c = startClock(T0);
    expect(readClock(c, T0 + 12_000, TOTAL)).toEqual({
      elapsedMs: 12_000,
      activeMs: 12_000,
      running: true,
    });
  });

  it('starts paused when there was no Start tap, and does not move', () => {
    const c = pausedClock();
    expect(readClock(c, T0 + 999_999, TOTAL)).toEqual({
      elapsedMs: 0,
      activeMs: 0,
      running: false,
    });
  });

  it('pause folds the live span; paused time never counts', () => {
    const c = pauseClock(startClock(T0), T0 + 10_000, TOTAL);
    expect(c).toEqual({ tBase: 10_000, aBase: 10_000, since: null });
    expect(readClock(c, T0 + 500_000, TOTAL).elapsedMs).toBe(10_000);
    const r = resumeClock(c, T0 + 500_000);
    expect(readClock(r, T0 + 505_000, TOTAL)).toMatchObject({
      elapsedMs: 15_000,
      activeMs: 15_000,
    });
    // Pausing an already-paused clock is a no-op.
    expect(pauseClock(c, T0 + 1, TOTAL)).toBe(c);
    // Resuming a running clock is a no-op.
    expect(resumeClock(r, T0 + 9e9)).toBe(r);
  });

  it('seek moves position but keeps active time honest', () => {
    const c = seekClock(startClock(T0), T0 + 5000, 30_000, TOTAL);
    expect(c).toEqual({ tBase: 30_000, aBase: 5000, since: T0 + 5000 });
    expect(readClock(c, T0 + 7000, TOTAL)).toMatchObject({ elapsedMs: 32_000, activeMs: 7000 });
    // Seeking while paused stays paused; targets clamp to the timeline.
    const p = seekClock(pausedClock(), T0, TOTAL + 5000, TOTAL);
    expect(p).toEqual({ tBase: TOTAL, aBase: 0, since: null });
  });

  it('hide then return after the routine would have ended: no time counts, not done', () => {
    const tl = buildTimeline(
      [
        { stretchId: 'a', holdSec: 20 },
        { stretchId: 'b', holdSec: 25 },
      ],
      5,
    );
    // 12 s in, the phone is locked for ten minutes.
    let c = startClock(T0);
    c = hideClock(c, T0 + 12_000, tl.totalMs);
    const back = T0 + 12_000 + 600_000;
    const r = readClock(c, back, tl.totalMs);
    expect(r).toEqual({ elapsedMs: 12_000, activeMs: 12_000, running: false });
    expect(locate(tl, r.elapsedMs).done).toBe(false);
    // Resumes only on a tap, from where it was.
    c = resumeClock(c, back);
    expect(readClock(c, back + 3000, tl.totalMs).elapsedMs).toBe(15_000);
  });

  it('a missed hide is caught: the frozen gap is dropped at the last seen moment', () => {
    const c = startClock(T0);
    const lastSeen = T0 + 8000;
    const back = lastSeen + 300_000;
    const { clock, stalled } = catchUpClock(c, lastSeen, back, 4000, TOTAL);
    expect(stalled).toBe(true);
    expect(readClock(clock, back, TOTAL)).toEqual({
      elapsedMs: 8000,
      activeMs: 8000,
      running: false,
    });
    // Normal 200 ms ticks are not a stall.
    expect(catchUpClock(c, T0 + 8000, T0 + 8200, 4000, TOTAL).stalled).toBe(false);
    // A paused clock never stalls.
    expect(catchUpClock(pausedClock(), 0, 9e9, 4000, TOTAL).stalled).toBe(false);
  });

  it('active time never counts past the end, and freeze holds the end', () => {
    const c = startClock(T0);
    const r = readClock(c, T0 + TOTAL + 2000, TOTAL);
    expect(r).toMatchObject({ elapsedMs: TOTAL, activeMs: TOTAL });
    const f = freezeClock(c, T0 + TOTAL + 2000, TOTAL);
    expect(f).toEqual({ tBase: TOTAL, aBase: TOTAL, since: null });
    // Frozen at the end: the display stays done instead of snapping back.
    expect(readClock(f, T0 + 9e9, TOTAL).elapsedMs).toBe(TOTAL);
  });

  it('skipped holds do not count as active time', () => {
    let c = startClock(T0);
    c = seekClock(c, T0 + 2000, TOTAL, TOTAL); // skip to end after 2 s
    const f = freezeClock(c, T0 + 2100, TOTAL);
    expect(f.aBase).toBe(2000);
  });
});

describe('autostart token', () => {
  it('is fresh only shortly after Start, and cleared on consume', () => {
    clearAutostart();
    expect(isAutostartFresh(T0)).toBe(false); // reload: never armed
    armAutostart(T0);
    expect(isAutostartFresh(T0 + 100)).toBe(true);
    expect(isAutostartFresh(T0 + 100)).toBe(true); // pure read (Strict Mode safe)
    expect(isAutostartFresh(T0 + 60_000)).toBe(false); // stale
    clearAutostart();
    expect(isAutostartFresh(T0 + 100)).toBe(false); // history forward later
  });
});

describe('next local midnight', () => {
  it('schedules just after the next local midnight', () => {
    const now = new Date(2026, 10, 15, 23, 59, 0);
    expect(msUntilNextLocalDay(now)).toBe(61_000);
    const morning = new Date(2026, 10, 15, 6, 0, 0);
    const next = new Date(morning.getTime() + msUntilNextLocalDay(morning));
    expect(next.getDate()).toBe(16);
    expect(next.getHours()).toBe(0);
  });
});
