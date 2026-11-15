import { describe, it, expect } from 'vitest';
import { backTarget, buildTimeline, locate, skipTarget } from '../playerTimeline.ts';

const steps = [
  { stretchId: 'chin-tuck', holdSec: 20 },
  { stretchId: 'upper-trap', side: 'left' as const, holdSec: 30 },
  { stretchId: 'upper-trap', side: 'right' as const, holdSec: 30 },
];

describe('player timeline', () => {
  const tl = buildTimeline(steps, 5);

  it('alternates prep and hold, totalling holds plus 5 s per step', () => {
    expect(tl.phases.map((p) => `${p.kind}${p.stepIndex}`)).toEqual([
      'prep0',
      'hold0',
      'prep1',
      'hold1',
      'prep2',
      'hold2',
    ]);
    expect(tl.totalMs).toBe((20 + 30 + 30 + 15) * 1000);
  });

  it('locates any elapsed time, including a throttled jump across phases', () => {
    expect(locate(tl, 0).phase?.kind).toBe('prep');
    expect(locate(tl, 4999).phase?.kind).toBe('prep');
    const h = locate(tl, 5000);
    expect(h.phase?.kind).toBe('hold');
    expect(h.remainingMs).toBe(20000);
    // A 40 s gap lands straight in step 1's hold.
    const later = locate(tl, 45_000);
    expect(later.phase).toMatchObject({ kind: 'hold', stepIndex: 1 });
    expect(later.remainingMs).toBe(15_000);
    expect(locate(tl, tl.totalMs).done).toBe(true);
    expect(locate(tl, tl.totalMs + 999_999).done).toBe(true);
    expect(locate(tl, -50).phase?.kind).toBe('prep');
  });

  it('skip goes to the next transition, or the end from the last step', () => {
    expect(skipTarget(tl, 1000)).toBe(25_000);
    expect(skipTarget(tl, 10_000)).toBe(25_000);
    expect(skipTarget(tl, 70_000)).toBe(tl.totalMs);
  });

  it('back restarts the current step after 3 s of hold, else the previous one', () => {
    expect(backTarget(tl, 35_000)).toBe(25_000); // 5 s into hold1 -> restart step 1
    expect(backTarget(tl, 31_000)).toBe(0); // 1 s into hold1 -> step 0
    expect(backTarget(tl, 26_000)).toBe(0); // in prep1 -> step 0
    expect(backTarget(tl, 2000)).toBe(0); // first step clamps
    expect(backTarget(tl, tl.totalMs)).toBe(60_000); // from done -> last step
  });
});
