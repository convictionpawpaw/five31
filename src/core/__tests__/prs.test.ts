import { describe, it, expect } from 'vitest';
import { computePrTimeline, amrapTargetForPr } from '../prs.ts';
import { epley } from '../e1rm.ts';

describe('computePrTimeline', () => {
  it('flags only strictly-increasing running-max e1RM efforts', () => {
    const timeline = computePrTimeline([
      { weight: 200, reps: 5 }, // e1RM 233.3 — first, PR
      { weight: 200, reps: 5 }, // equal, NOT a PR (strict)
      { weight: 205, reps: 5 }, // higher, PR
      { weight: 200, reps: 8 }, // 253.3 > 239.2, PR
      { weight: 200, reps: 3 }, // lower, NOT a PR
    ]);
    expect(timeline.map((e) => e.isPr)).toEqual([true, false, true, true, false]);
  });

  it('the first valid effort is always a PR', () => {
    const timeline = computePrTimeline([{ weight: 95, reps: 10 }]);
    expect(timeline[0]!.isPr).toBe(true);
    expect(timeline[0]!.e1rm).toBe(epley(95, 10));
  });

  it('ignores efforts with no valid e1RM and does not move the running max', () => {
    const timeline = computePrTimeline([
      { weight: 100, reps: 0 }, // invalid → e1rm null, not a PR
      { weight: 100, reps: 5 }, // first VALID → PR
      { weight: 100, reps: -2 }, // invalid → not a PR
    ]);
    expect(timeline[0]!.isPr).toBe(false);
    expect(timeline[0]!.e1rm).toBeNull();
    expect(timeline[1]!.isPr).toBe(true);
    expect(timeline[2]!.isPr).toBe(false);
  });

  it('carries the ref through for correlation', () => {
    const timeline = computePrTimeline([{ weight: 100, reps: 5, ref: 'w-123' }]);
    expect(timeline[0]!.ref).toBe('w-123');
  });
});

describe('amrapTargetForPr', () => {
  it('returns the smallest rep count that beats the record', () => {
    // Record e1RM = 233.3 (from 200x5). At 205, how many reps to beat it?
    const record = epley(200, 5)!; // 233.3
    const target = amrapTargetForPr(205, record);
    // 205*(1+5/30)=239.2 > 233.3, 205*(1+4/30)=232.3 < 233.3 → need 5.
    expect(target).toBe(5);
    // Confirm it is indeed the smallest.
    expect(epley(205, target! - 1)!).toBeLessThanOrEqual(record);
    expect(epley(205, target!)!).toBeGreaterThan(record);
  });

  it('needs only 1 rep when the weight alone beats the record', () => {
    const record = epley(100, 5)!; // 116.7
    expect(amrapTargetForPr(200, record)).toBe(1);
  });

  it('returns 1 when there is no existing record', () => {
    expect(amrapTargetForPr(135, null)).toBe(1);
  });

  it('returns null when the record is unreachable within 30 reps', () => {
    const record = epley(500, 5)!; // 583.3
    // At 100 lb, even 30 reps → 100*2 = 200 < 583.3.
    expect(amrapTargetForPr(100, record)).toBeNull();
  });

  it('respects a custom maxReps ceiling', () => {
    const record = epley(300, 5)!; // 350
    // At 200, 200*(1+ reps/30) > 350 needs reps > 22.5 → 23 reps.
    expect(amrapTargetForPr(200, record, 30)).toBe(23);
    expect(amrapTargetForPr(200, record, 10)).toBeNull();
  });
});
