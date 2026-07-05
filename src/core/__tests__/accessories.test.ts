import { describe, it, expect } from 'vitest';
import { evaluateAccessoryProgression, buildAccessoryWork } from '../accessories.ts';
import type { AccessoryDef } from '../types.ts';

describe('evaluateAccessoryProgression', () => {
  it('progresses only when ALL sets meet or exceed repRangeMax', () => {
    expect(evaluateAccessoryProgression([12, 12, 12], 3, 12)).toBe(true);
    expect(evaluateAccessoryProgression([15, 13, 12], 3, 12)).toBe(true); // above max ok
  });

  it('does NOT progress when any set is below repRangeMax', () => {
    expect(evaluateAccessoryProgression([12, 11, 12], 3, 12)).toBe(false);
    expect(evaluateAccessoryProgression([8, 8, 8], 3, 12)).toBe(false);
  });

  it('does NOT progress when any set is null', () => {
    expect(evaluateAccessoryProgression([12, null, 12], 3, 12)).toBe(false);
    expect(evaluateAccessoryProgression([null, null, null], 3, 12)).toBe(false);
  });

  it('does NOT progress when a set is missing (short array)', () => {
    expect(evaluateAccessoryProgression([12, 12], 3, 12)).toBe(false);
    expect(evaluateAccessoryProgression([], 3, 12)).toBe(false);
  });

  it('handles a single-set accessory', () => {
    expect(evaluateAccessoryProgression([10], 1, 10)).toBe(true);
    expect(evaluateAccessoryProgression([9], 1, 10)).toBe(false);
    expect(evaluateAccessoryProgression([null], 1, 10)).toBe(false);
  });
});

describe('buildAccessoryWork', () => {
  const def: AccessoryDef = {
    id: 'acc1',
    liftDayId: 'bench',
    name: 'Chin-ups',
    sets: 3,
    repRangeMin: 8,
    repRangeMax: 12,
    currentWeight: 25,
    increment: 5,
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('snapshots the definition and stamps the current weight', () => {
    const work = buildAccessoryWork(def);
    expect(work.accessoryId).toBe('acc1');
    expect(work.name).toBe('Chin-ups');
    expect(work.weight).toBe(25);
    expect(work.targetSets).toBe(3);
    expect(work.repRangeMin).toBe(8);
    expect(work.repRangeMax).toBe(12);
    expect(work.progressed).toBe(false);
  });

  it('initialises setReps to nulls of length === sets', () => {
    const work = buildAccessoryWork(def);
    expect(work.setReps).toEqual([null, null, null]);
    expect(work.setReps).toHaveLength(3);
  });
});
