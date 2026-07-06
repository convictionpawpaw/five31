import { describe, it, expect } from 'vitest';
import type { LiftId, MainSet, Workout, WorkoutStatus, WeekNumber } from '../../../core/types.ts';
import {
  compareWorkoutOrder,
  isCycleResolved,
  lastCompletedWorkout,
  makeWorkoutOrderComparator,
  selectNextWorkout,
  topWorkSet,
} from '../workoutSelect.ts';

function work(index: number, weight: number, targetReps: number, amrap = false): MainSet {
  return { kind: 'work', index, percent: 0.85, weight, targetReps, amrap };
}

function mk(
  id: string,
  week: WeekNumber,
  liftId: LiftId,
  status: WorkoutStatus,
  extra: Partial<Workout> = {},
): Workout {
  return {
    id,
    cycleId: 'c1',
    cycleNumber: 1,
    week,
    liftId,
    status,
    tmUsed: 200,
    mainSets: [work(0, 130, 5), work(1, 150, 5), work(2, 170, 5, true)],
    accessoryWork: [],
    units: 'lb',
    ...extra,
  };
}

describe('compareWorkoutOrder', () => {
  it('orders by week then DAY_ORDER (press, deadlift, bench, squat)', () => {
    const ws = [
      mk('a', 2, 'press', 'pending'),
      mk('b', 1, 'squat', 'pending'),
      mk('c', 1, 'press', 'pending'),
      mk('d', 1, 'bench', 'pending'),
    ];
    const sorted = [...ws].sort(compareWorkoutOrder).map((w) => w.id);
    expect(sorted).toEqual(['c', 'd', 'b', 'a']);
  });
});

describe('selectNextWorkout', () => {
  it('prefers an in_progress workout over any pending one', () => {
    const ws = [
      mk('p1', 1, 'press', 'pending'),
      mk('ip', 1, 'squat', 'in_progress'),
    ];
    expect(selectNextWorkout(ws)?.id).toBe('ip');
  });

  it('falls back to the earliest pending by week/day order', () => {
    const ws = [
      mk('later', 2, 'press', 'pending'),
      mk('done', 1, 'press', 'completed'),
      mk('early', 1, 'deadlift', 'pending'),
    ];
    expect(selectNextWorkout(ws)?.id).toBe('early');
  });

  it('returns null when every workout is resolved', () => {
    const ws = [
      mk('a', 1, 'press', 'completed'),
      mk('b', 1, 'deadlift', 'skipped'),
    ];
    expect(selectNextWorkout(ws)).toBeNull();
  });

  it('respects a custom dayOrder: squat wk1 beats press wk1', () => {
    const custom: LiftId[] = ['squat', 'bench', 'deadlift', 'press'];
    const ws = [
      mk('press-1', 1, 'press', 'pending'),
      mk('squat-1', 1, 'squat', 'pending'),
    ];
    // Classic order → press first.
    expect(selectNextWorkout(ws)?.id).toBe('press-1');
    // Custom order → squat first.
    expect(selectNextWorkout(ws, custom)?.id).toBe('squat-1');
  });

  it('a malformed custom order falls back to the classic default', () => {
    const bad: LiftId[] = ['squat', 'squat', 'bench', 'press']; // duplicate
    const ws = [
      mk('press-1', 1, 'press', 'pending'),
      mk('squat-1', 1, 'squat', 'pending'),
    ];
    expect(selectNextWorkout(ws, bad)?.id).toBe('press-1');
  });
});

describe('makeWorkoutOrderComparator', () => {
  it('sorts within a week by the given order, week-major', () => {
    const custom: LiftId[] = ['squat', 'bench', 'deadlift', 'press'];
    const ws = [
      mk('a', 2, 'squat', 'pending'),
      mk('b', 1, 'press', 'pending'),
      mk('c', 1, 'squat', 'pending'),
      mk('d', 1, 'bench', 'pending'),
    ];
    const sorted = [...ws].sort(makeWorkoutOrderComparator(custom)).map((w) => w.id);
    // Week 1 first (squat, bench, …, press), then week 2 squat.
    expect(sorted).toEqual(['c', 'd', 'b', 'a']);
  });
});

describe('isCycleResolved', () => {
  it('is true only when all completed/skipped and non-empty', () => {
    expect(isCycleResolved([])).toBe(false);
    expect(isCycleResolved([mk('a', 1, 'press', 'completed'), mk('b', 1, 'bench', 'skipped')])).toBe(true);
    expect(isCycleResolved([mk('a', 1, 'press', 'completed'), mk('b', 1, 'bench', 'pending')])).toBe(false);
  });
});

describe('topWorkSet', () => {
  it('returns the last work set (the AMRAP in weeks 1–3)', () => {
    const w = mk('a', 1, 'press', 'pending');
    expect(topWorkSet(w)?.weight).toBe(170);
    expect(topWorkSet(w)?.amrap).toBe(true);
  });
});

describe('lastCompletedWorkout', () => {
  it('picks the most recent completedAt, ignoring skipped/pending', () => {
    const ws = [
      mk('old', 1, 'press', 'completed', { completedAt: '2026-01-01T10:00:00Z' }),
      mk('new', 1, 'bench', 'completed', { completedAt: '2026-01-03T10:00:00Z' }),
      mk('skip', 1, 'squat', 'skipped', { completedAt: '2026-01-05T10:00:00Z' }),
    ];
    expect(lastCompletedWorkout(ws)?.id).toBe('new');
  });

  it('returns null when nothing is completed', () => {
    expect(lastCompletedWorkout([mk('a', 1, 'press', 'pending')])).toBeNull();
  });
});
