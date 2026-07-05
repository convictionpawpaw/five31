import { describe, it, expect } from 'vitest';
import { epley } from '../e1rm.ts';

describe('epley', () => {
  it('matches the golden vector epley(200, 5) = 233.3', () => {
    expect(epley(200, 5)).toBe(233.3);
  });

  it('returns the weight itself at 1 rep', () => {
    expect(epley(200, 1)).toBe(200);
    expect(epley(135, 1)).toBe(135);
    expect(epley(0, 1)).toBe(0);
  });

  it('returns null for zero or negative reps', () => {
    expect(epley(200, 0)).toBeNull();
    expect(epley(200, -3)).toBeNull();
  });

  it('increases with reps for a fixed weight', () => {
    const a = epley(100, 3)!;
    const b = epley(100, 8)!;
    expect(a).toBeLessThan(b);
    expect(a).toBeCloseTo(110, 5); // 100 * (1 + 3/30)
    expect(b).toBeCloseTo(126.7, 1); // 100 * (1 + 8/30) = 126.666...
  });

  it('rounds to one decimal place', () => {
    // 185 * (1 + 5/30) = 215.8333...
    expect(epley(185, 5)).toBe(215.8);
  });
});
