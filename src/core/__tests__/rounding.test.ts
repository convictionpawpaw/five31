import { describe, it, expect } from 'vitest';
import { roundToIncrement } from '../rounding.ts';

describe('roundToIncrement', () => {
  it('matches the mandatory golden vectors', () => {
    expect(roundToIncrement(138.75, 5)).toBe(140);
    expect(roundToIncrement(157.25, 5)).toBe(155);
    expect(roundToIncrement(146.25, 2.5)).toBe(147.5);
    expect(roundToIncrement(0, 5)).toBe(0);
  });

  it('rounds ties up (half-up)', () => {
    // Exactly halfway between multiples of 5 rounds to the higher multiple.
    expect(roundToIncrement(2.5, 5)).toBe(5);
    expect(roundToIncrement(7.5, 5)).toBe(10);
    expect(roundToIncrement(12.5, 5)).toBe(15);
    // Halfway on a 2.5 grid.
    expect(roundToIncrement(1.25, 2.5)).toBe(2.5);
  });

  it('rounds to the nearest multiple below the halfway point down', () => {
    expect(roundToIncrement(2.49, 5)).toBe(0);
    expect(roundToIncrement(7.49, 5)).toBe(5);
    expect(roundToIncrement(146.24, 2.5)).toBe(145);
  });

  it('is stable on exact multiples', () => {
    expect(roundToIncrement(140, 5)).toBe(140);
    expect(roundToIncrement(155, 5)).toBe(155);
    expect(roundToIncrement(147.5, 2.5)).toBe(147.5);
  });

  it('handles fine kg increments without float drift', () => {
    expect(roundToIncrement(61.3, 1.25)).toBe(61.25);
    expect(roundToIncrement(61.875, 1.25)).toBe(62.5); // tie rounds up
    expect(roundToIncrement(90, 2.5)).toBe(90);
  });

  it('returns the input unchanged for a non-positive increment', () => {
    expect(roundToIncrement(137, 0)).toBe(137);
  });
});
