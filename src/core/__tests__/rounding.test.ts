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

  it('rounds a float product that lands just under a true tie UP (audit cases)', () => {
    // 81.25 × 0.70 is exactly 56.875 but evaluates to 56.87499999… in binary.
    expect(roundToIncrement(81.25 * 0.7, 1.25)).toBe(57.5);
    // The other audited TMs at 70% with a 1.25 kg increment.
    for (const tm of [43.75, 168.75, 181.25, 331.25, 343.75, 356.25]) {
      const exactCentis = tm * 100 * 70; // exact: tm is on a 0.25 grid
      const expected = exactReference(Math.round(tm * 4), 70, 1.25);
      expect(roundToIncrement(tm * 0.7, 1.25), `TM ${tm} (${exactCentis})`).toBe(expected);
    }
  });
});

/**
 * Exact rational reference: weight = (k/4) × (p/100) = kp/400. Expressed in
 * units of 1/400, the increment is inc × 400 (an integer for 1.25/2.5/5), and
 * half-up nearest is floor((2kp + incU) / (2·incU)) · incU / 400 — all integers.
 */
function exactReference(k: number, p: number, inc: number): number {
  const incU = Math.round(inc * 400);
  const q = Math.floor((2 * k * p + incU) / (2 * incU));
  return (q * incU) / 400;
}

describe('roundToIncrement — brute force against an exact rational reference', () => {
  // Every percentage the program uses (warmups, weeks 1-3, deload), plus the
  // 90% "reset" shortcut in the complete-cycle modal.
  const PERCENTS = [0.4, 0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
  const INCREMENTS = [1.25, 2.5, 5];

  it('agrees for every TM on a 0.25 grid 0..600, every percentage and increment', () => {
    const mismatches: string[] = [];
    for (let k = 0; k <= 2400; k++) {
      const tm = k / 4;
      for (const pct of PERCENTS) {
        const p = Math.round(pct * 100);
        for (const inc of INCREMENTS) {
          const got = roundToIncrement(tm * pct, inc);
          const want = exactReference(k, p, inc);
          if (got !== want) mismatches.push(`tm ${tm} × ${pct} @ ${inc}: got ${got}, want ${want}`);
        }
      }
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
  });
});
