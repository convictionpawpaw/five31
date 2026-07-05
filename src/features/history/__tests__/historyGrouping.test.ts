import { describe, it, expect } from 'vitest';
import type { Cycle, LiftId, MainSet, Units, Workout, WorkoutStatus } from '../../../core/types.ts';
import { computePrWorkoutIds, groupHistoryByCycle } from '../historyGrouping.ts';

let seq = 0;
/** Monotonic id so completedKey fallback ordering is deterministic. */
function nextId(): string {
  seq += 1;
  return String(seq).padStart(6, '0');
}

function amrap(weight: number, actualReps: number | undefined): MainSet {
  return { kind: 'work', index: 2, percent: 0.85, weight, targetReps: 5, amrap: true, actualReps };
}

function mkWorkout(opts: {
  id?: string;
  cycleId: string;
  cycleNumber: number;
  liftId: LiftId;
  status: WorkoutStatus;
  amrapWeight?: number;
  amrapReps?: number;
  units?: Units;
  completedAt?: string;
}): Workout {
  const units: Units = opts.units ?? 'lb';
  const mainSets: MainSet[] =
    opts.amrapWeight !== undefined ? [amrap(opts.amrapWeight, opts.amrapReps)] : [];
  return {
    id: opts.id ?? nextId(),
    cycleId: opts.cycleId,
    cycleNumber: opts.cycleNumber,
    week: 1,
    liftId: opts.liftId,
    status: opts.status,
    tmUsed: 200,
    mainSets,
    accessoryWork: [],
    units,
    completedAt: opts.completedAt,
  };
}

function mkCycle(id: string, number: number): Cycle {
  return {
    id,
    number,
    status: number === 2 ? 'active' : 'completed',
    startedAt: '2026-01-01T00:00:00.000Z',
    tms: { press: 100, deadlift: 300, bench: 150, squat: 250 },
    includeDeload: false,
    units: 'lb',
  };
}

describe('computePrWorkoutIds', () => {
  it('flags each strictly-increasing e1RM AMRAP across cycles per lift', () => {
    seq = 0;
    const w1 = mkWorkout({ id: 'a', cycleId: 'c1', cycleNumber: 1, liftId: 'press', status: 'completed', amrapWeight: 100, amrapReps: 5, completedAt: '2026-01-02' });
    const w2 = mkWorkout({ id: 'b', cycleId: 'c1', cycleNumber: 1, liftId: 'press', status: 'completed', amrapWeight: 100, amrapReps: 8, completedAt: '2026-01-09' });
    const w3 = mkWorkout({ id: 'c', cycleId: 'c2', cycleNumber: 2, liftId: 'press', status: 'completed', amrapWeight: 105, amrapReps: 3, completedAt: '2026-01-16' });
    const ids = computePrWorkoutIds([w2, w3, w1]); // unordered input
    // first effort is always a PR; 8 reps beats it; 105x3 e1rm ~115.5 beats 100x8 ~126.7? check
    // 100x8 => 100*(1+8/30)=126.67 ; 105x3 => 105*1.1=115.5 → NOT a PR
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(true);
    expect(ids.has('c')).toBe(false);
  });

  it('ignores skipped workouts and unlogged AMRAPs', () => {
    seq = 0;
    const skipped = mkWorkout({ id: 's', cycleId: 'c1', cycleNumber: 1, liftId: 'bench', status: 'skipped' });
    const unlogged = mkWorkout({ id: 'u', cycleId: 'c1', cycleNumber: 1, liftId: 'bench', status: 'completed', amrapWeight: 150, amrapReps: undefined, completedAt: '2026-02-01' });
    const ids = computePrWorkoutIds([skipped, unlogged]);
    expect(ids.size).toBe(0);
  });

  it('normalises cross-unit efforts into the first effort units', () => {
    seq = 0;
    // First effort in lb: 100 lb x 5 → e1rm 116.7 lb.
    const lbW = mkWorkout({ id: 'lb', cycleId: 'c1', cycleNumber: 1, liftId: 'squat', status: 'completed', amrapWeight: 100, amrapReps: 5, units: 'lb', completedAt: '2026-03-01' });
    // Second effort logged in kg but heavier: 60 kg x 5 → ~132 lb e1rm → PR.
    const kgW = mkWorkout({ id: 'kg', cycleId: 'c2', cycleNumber: 2, liftId: 'squat', status: 'completed', amrapWeight: 60, amrapReps: 5, units: 'kg', completedAt: '2026-03-08' });
    const ids = computePrWorkoutIds([lbW, kgW]);
    expect(ids.has('lb')).toBe(true);
    expect(ids.has('kg')).toBe(true);
  });
});

describe('groupHistoryByCycle', () => {
  it('groups resolved workouts by cycle, newest cycle first, and drops empty cycles', () => {
    seq = 0;
    const c1 = mkCycle('c1', 1);
    const c2 = mkCycle('c2', 2);
    const c3 = mkCycle('c3', 3); // no resolved workouts → dropped
    const w1 = mkWorkout({ id: 'w1', cycleId: 'c1', cycleNumber: 1, liftId: 'press', status: 'completed', amrapWeight: 100, amrapReps: 5, completedAt: '2026-01-02' });
    const w2 = mkWorkout({ id: 'w2', cycleId: 'c2', cycleNumber: 2, liftId: 'press', status: 'completed', amrapWeight: 100, amrapReps: 8, completedAt: '2026-01-09' });
    const pending = mkWorkout({ id: 'p', cycleId: 'c3', cycleNumber: 3, liftId: 'press', status: 'pending' });

    const groups = groupHistoryByCycle([c1, c2, c3], [w1, w2, pending]);
    expect(groups.map((g) => g.cycle.number)).toEqual([2, 1]);
    expect(groups[0]!.rows).toHaveLength(1);
    expect(groups[0]!.rows[0]!.workout.id).toBe('w2');
    expect(groups[0]!.rows[0]!.isPr).toBe(true);
  });

  it('orders rows within a group by completion recency (newest first)', () => {
    seq = 0;
    const c1 = mkCycle('c1', 1);
    const early = mkWorkout({ id: 'early', cycleId: 'c1', cycleNumber: 1, liftId: 'press', status: 'completed', amrapWeight: 100, amrapReps: 5, completedAt: '2026-01-02' });
    const late = mkWorkout({ id: 'late', cycleId: 'c1', cycleNumber: 1, liftId: 'deadlift', status: 'completed', amrapWeight: 300, amrapReps: 5, completedAt: '2026-01-05' });
    const groups = groupHistoryByCycle([c1], [early, late]);
    expect(groups[0]!.rows.map((r) => r.workout.id)).toEqual(['late', 'early']);
  });

  it('includes skipped workouts as rows (never as PRs)', () => {
    seq = 0;
    const c1 = mkCycle('c1', 1);
    const skipped = mkWorkout({ id: 'sk', cycleId: 'c1', cycleNumber: 1, liftId: 'bench', status: 'skipped' });
    const groups = groupHistoryByCycle([c1], [skipped]);
    expect(groups[0]!.rows).toHaveLength(1);
    expect(groups[0]!.rows[0]!.isPr).toBe(false);
  });
});
