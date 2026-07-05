import { describe, it, expect } from 'vitest';
import { buildMainSets } from '../setCalc.ts';
import type { MainSet } from '../types.ts';
import {
  convertWeight,
  LB_PER_KG,
  defaultLiftIncrements,
  defaultRoundingIncrement,
} from '../units.ts';

const weightsOf = (sets: MainSet[], kind: 'warmup' | 'work') =>
  sets.filter((s) => s.kind === kind).map((s) => s.weight);
const repsOf = (sets: MainSet[], kind: 'warmup' | 'work') =>
  sets.filter((s) => s.kind === kind).map((s) => s.targetReps);

describe('buildMainSets — golden vectors', () => {
  it('TM 200 lb, inc 5, week 1', () => {
    const sets = buildMainSets(200, 1, 5);
    // 3 warmups + 3 work.
    expect(sets.filter((s) => s.kind === 'warmup')).toHaveLength(3);
    expect(sets.filter((s) => s.kind === 'work')).toHaveLength(3);

    expect(weightsOf(sets, 'warmup')).toEqual([80, 100, 120]);
    expect(repsOf(sets, 'warmup')).toEqual([5, 5, 3]);

    expect(weightsOf(sets, 'work')).toEqual([130, 150, 170]);
    expect(repsOf(sets, 'work')).toEqual([5, 5, 5]);

    // AMRAP only on the last work set.
    const work = sets.filter((s) => s.kind === 'work');
    expect(work.map((s) => s.amrap)).toEqual([false, false, true]);
    expect(sets.filter((s) => s.amrap)).toHaveLength(1);
  });

  it('TM 185 lb, inc 5, week 3', () => {
    const sets = buildMainSets(185, 3, 5);
    expect(weightsOf(sets, 'work')).toEqual([140, 155, 175]);
    expect(repsOf(sets, 'work')).toEqual([5, 3, 1]);
    const work = sets.filter((s) => s.kind === 'work');
    // 1+ AMRAP on the final set.
    expect(work[2]!.amrap).toBe(true);
    expect(work[0]!.amrap).toBe(false);
    expect(work[1]!.amrap).toBe(false);
  });

  it('week 4 deload: 3 work sets 40/50/60%, no warmups, no AMRAP', () => {
    const sets = buildMainSets(200, 4, 5);
    expect(sets.filter((s) => s.kind === 'warmup')).toHaveLength(0);
    expect(sets.filter((s) => s.kind === 'work')).toHaveLength(3);
    expect(weightsOf(sets, 'work')).toEqual([80, 100, 120]);
    expect(sets.some((s) => s.amrap)).toBe(false);
    expect(sets.map((s) => s.percent)).toEqual([0.4, 0.5, 0.6]);
  });

  it('kg vector: TM 100 kg, inc 2.5, week 2 → work 70/80/90', () => {
    const sets = buildMainSets(100, 2, 2.5);
    expect(weightsOf(sets, 'work')).toEqual([70, 80, 90]);
    expect(repsOf(sets, 'work')).toEqual([3, 3, 3]);
    const work = sets.filter((s) => s.kind === 'work');
    expect(work[2]!.amrap).toBe(true);
  });

  it('week 2 percents are 70/80/90 of TM', () => {
    const sets = buildMainSets(300, 2, 5);
    const work = sets.filter((s) => s.kind === 'work');
    expect(work.map((s) => s.percent)).toEqual([0.7, 0.8, 0.9]);
    expect(work.map((s) => s.weight)).toEqual([210, 240, 270]);
  });

  it('warmup percents are always 40/50/60 for main weeks', () => {
    const sets = buildMainSets(185, 3, 5);
    const warm = sets.filter((s) => s.kind === 'warmup');
    expect(warm.map((s) => s.percent)).toEqual([0.4, 0.5, 0.6]);
  });
});

describe('units', () => {
  it('exposes the exact lb/kg factor', () => {
    expect(LB_PER_KG).toBe(0.45359237);
  });

  it('converts lb → kg and back', () => {
    expect(convertWeight(100, 'lb', 'kg')).toBeCloseTo(45.359237, 6);
    expect(convertWeight(100, 'kg', 'lb')).toBeCloseTo(220.462262, 5);
    expect(convertWeight(135, 'lb', 'lb')).toBe(135);
  });

  it('provides unit-dependent defaults', () => {
    expect(defaultRoundingIncrement('lb')).toBe(5);
    expect(defaultRoundingIncrement('kg')).toBe(2.5);
    expect(defaultLiftIncrements('lb')).toEqual({
      press: 5,
      bench: 5,
      squat: 10,
      deadlift: 10,
    });
    expect(defaultLiftIncrements('kg')).toEqual({
      press: 2.5,
      bench: 2.5,
      squat: 5,
      deadlift: 5,
    });
  });
});
