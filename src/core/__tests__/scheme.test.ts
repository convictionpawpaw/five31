import { describe, it, expect } from 'vitest';
import { DAY_ORDER, normalizeDayOrder } from '../scheme.ts';
import type { LiftId } from '../types.ts';

const CUSTOM: readonly LiftId[] = ['squat', 'bench', 'deadlift', 'press'];

describe('normalizeDayOrder', () => {
  it('returns DAY_ORDER for undefined', () => {
    expect(normalizeDayOrder(undefined)).toBe(DAY_ORDER);
  });

  it('returns a valid permutation unchanged (same reference)', () => {
    expect(normalizeDayOrder(CUSTOM)).toBe(CUSTOM);
    expect(normalizeDayOrder(CUSTOM)).toEqual(['squat', 'bench', 'deadlift', 'press']);
  });

  it('accepts the canonical order itself', () => {
    const same = ['press', 'deadlift', 'bench', 'squat'] as LiftId[];
    expect(normalizeDayOrder(same)).toBe(same);
  });

  it('falls back to DAY_ORDER on wrong length (too short)', () => {
    expect(normalizeDayOrder(['squat', 'bench', 'press'] as LiftId[])).toBe(DAY_ORDER);
  });

  it('falls back to DAY_ORDER on wrong length (too long)', () => {
    expect(
      normalizeDayOrder(['squat', 'bench', 'deadlift', 'press', 'press'] as LiftId[]),
    ).toBe(DAY_ORDER);
  });

  it('falls back to DAY_ORDER on a duplicate (right length)', () => {
    expect(normalizeDayOrder(['squat', 'squat', 'bench', 'press'] as LiftId[])).toBe(DAY_ORDER);
  });

  it('falls back to DAY_ORDER on an unknown id', () => {
    expect(
      normalizeDayOrder(['squat', 'bench', 'deadlift', 'curl' as LiftId]),
    ).toBe(DAY_ORDER);
  });

  it('falls back to DAY_ORDER on an empty array', () => {
    expect(normalizeDayOrder([])).toBe(DAY_ORDER);
  });

  it('does not mutate its input', () => {
    const input: LiftId[] = ['squat', 'bench', 'deadlift', 'press'];
    const snapshot = [...input];
    normalizeDayOrder(input);
    expect(input).toEqual(snapshot);
  });
});
