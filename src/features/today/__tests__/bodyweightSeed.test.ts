import { describe, it, expect } from 'vitest';
import type { BodyweightEntry } from '../../../core/types.ts';
import { bodyweightSeed, defaultBodyweight } from '../bodyweightSeed.ts';

function entry(weight: number, units: 'lb' | 'kg'): BodyweightEntry {
  return { id: 'b1', date: '2026-07-01', weight, units };
}

describe('bodyweightSeed', () => {
  it('converts the last entry into the current units and rounds to the step', () => {
    // 180 lb = 81.646 kg → 0.5 kg step → 81.5.
    expect(bodyweightSeed(entry(180, 'lb'), 'kg')).toBe(81.5);
    // 82 kg = 180.78 lb → whole pounds → 181.
    expect(bodyweightSeed(entry(82, 'kg'), 'lb')).toBe(181);
  });

  it('keeps a same-unit entry exactly (on the step grid)', () => {
    expect(bodyweightSeed(entry(180, 'lb'), 'lb')).toBe(180);
    expect(bodyweightSeed(entry(81.5, 'kg'), 'kg')).toBe(81.5);
  });

  it('falls back to the unit default with no entry', () => {
    expect(bodyweightSeed(null, 'lb')).toBe(defaultBodyweight('lb'));
    expect(bodyweightSeed(null, 'kg')).toBe(defaultBodyweight('kg'));
  });
});
