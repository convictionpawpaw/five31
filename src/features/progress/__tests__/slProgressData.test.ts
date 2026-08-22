import { describe, it, expect } from 'vitest';
import type { Workout } from '../../../core/types.ts';
import { DAY_ORDER } from '../../../core/scheme.ts';
import { playInBlock, slBlock } from '../../sl/__tests__/slFixtures.ts';
import {
  PR_RESET_CAPTION,
  buildE1rmSeries,
  buildPrList,
  e1rmLiftChips,
  hasRowData,
  prResetCaption,
} from '../progressData.ts';

/** A classic 5/3/1 workout with a logged AMRAP — the friend-path shape. */
function classicWorkout(id: string, weight: number, reps: number, completedAt: string): Workout {
  return {
    id,
    cycleId: 'cycle-1',
    cycleNumber: 1,
    week: 1,
    liftId: 'press',
    status: 'completed',
    tmUsed: 120,
    mainSets: [
      { kind: 'work', index: 0, percent: 0.65, weight: weight - 20, targetReps: 5, amrap: false, actualReps: 5 },
      { kind: 'work', index: 1, percent: 0.85, weight, targetReps: 5, amrap: true, actualReps: reps },
    ],
    accessoryWork: [],
    units: 'lb',
    completedAt,
  };
}

describe('hasRowData / e1rmLiftChips', () => {
  it('hides the ROW chip on a pure 5/3/1 history', () => {
    const workouts = [classicWorkout('a', 170, 5, '2026-01-02T00:00:00.000Z')];
    expect(hasRowData(workouts)).toBe(false);
    expect(e1rmLiftChips(DAY_ORDER, workouts)).toEqual([...DAY_ORDER]);
  });

  it('APPENDS the ROW chip (never interleaves) as soon as a row workout exists', () => {
    const chips = e1rmLiftChips(DAY_ORDER, slBlock());
    expect(chips).toEqual([...DAY_ORDER, 'row']);
    expect(chips[chips.length - 1]).toBe('row');
  });

  it('shows the chip from a still-pending block — the lift is real once created', () => {
    expect(hasRowData(slBlock())).toBe(true);
  });

  it('honours the user day order for the four 5/3/1 lifts', () => {
    const order = ['squat', 'bench', 'deadlift', 'press'] as const;
    expect(e1rmLiftChips(order, slBlock())).toEqual(['squat', 'bench', 'deadlift', 'press', 'row']);
  });
});

describe('prResetCaption', () => {
  it('is null while the record timeline is unbroken (absent or empty)', () => {
    expect(prResetCaption(undefined)).toBeNull();
    expect(prResetCaption([])).toBeNull();
  });

  it('appears as soon as one reset has been recorded', () => {
    expect(prResetCaption(['2026-08-01T00:00:00.000Z'])).toBe(PR_RESET_CAPTION);
    expect(PR_RESET_CAPTION).toBe('Record reset at program switch — diamonds restart.');
  });
});

describe('buildE1rmSeries — StrongLifts efforts and reset epochs', () => {
  it('charts a StrongLifts lift from its best logged work set', () => {
    let block = playInBlock(slBlock(), 1, { completedAt: '2026-07-12T18:00:00.000Z' });
    block = playInBlock(block, 3, {
      completedAt: '2026-07-16T18:00:00.000Z',
      weights: { squat: 265 },
    });
    const series = buildE1rmSeries(block, 'squat', 'lb');
    expect(series.points).toHaveLength(2);
    expect(series.points.every((p) => p.isPr)).toBe(true);
    expect(series.best!.value).toBeGreaterThan(series.points[0]!.y);
  });

  it('charts the barbell row, which has no 5/3/1 equivalent', () => {
    const block = playInBlock(slBlock(), 1, { completedAt: '2026-07-12T18:00:00.000Z' });
    expect(buildE1rmSeries(block, 'row', 'lb').points).toHaveLength(1);
  });

  it('leaves the classic AMRAP path byte-identical (no resets)', () => {
    const workouts = [
      classicWorkout('a', 170, 5, '2026-01-02T00:00:00.000Z'),
      classicWorkout('b', 175, 3, '2026-01-09T00:00:00.000Z'),
    ];
    const series = buildE1rmSeries(workouts, 'press', 'lb');
    expect(series.points.map((p) => p.isPr)).toEqual([true, false]);
  });

  it('restarts the diamonds at a reset boundary', () => {
    const workouts = [
      classicWorkout('a', 200, 8, '2026-01-02T00:00:00.000Z'),
      classicWorkout('b', 150, 3, '2026-03-02T00:00:00.000Z'),
    ];
    expect(buildE1rmSeries(workouts, 'press', 'lb').points.map((p) => p.isPr)).toEqual([true, false]);
    expect(
      buildE1rmSeries(workouts, 'press', 'lb', ['2026-02-01T00:00:00.000Z']).points.map((p) => p.isPr),
    ).toEqual([true, true]);
  });
});

describe('buildPrList', () => {
  it('lists StrongLifts records alongside 5/3/1 ones, newest first', () => {
    const block = playInBlock(slBlock(), 1, { completedAt: '2026-07-12T18:00:00.000Z' });
    const prs = buildPrList([...block, classicWorkout('a', 170, 5, '2026-01-02T00:00:00.000Z')]);
    expect(prs[prs.length - 1]!.workoutId).toBe('a');
    expect(prs.some((p) => p.liftId === 'row')).toBe(true);
  });
});
