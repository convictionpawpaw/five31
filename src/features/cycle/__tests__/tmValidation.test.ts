import { describe, it, expect } from 'vitest';
import { invalidTmLifts, isValidTm } from '../tmValidation.ts';

describe('isValidTm / invalidTmLifts', () => {
  it('accepts only finite TMs above zero', () => {
    expect(isValidTm(135)).toBe(true);
    expect(isValidTm(1.25)).toBe(true);
    expect(isValidTm(0)).toBe(false);
    expect(isValidTm(-5)).toBe(false);
    expect(isValidTm(Number.NaN)).toBe(false);
    expect(isValidTm(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidTm(undefined)).toBe(false);
  });

  it('names every offending lift, in the order given', () => {
    expect(
      invalidTmLifts({ press: 0, bench: 200, squat: Number.NaN }, ['press', 'deadlift', 'bench', 'squat']),
    ).toEqual(['press', 'deadlift', 'squat']);
    expect(invalidTmLifts({ press: 1, bench: 2, squat: 3, deadlift: 4 }, ['press', 'bench'])).toEqual([]);
  });
});
