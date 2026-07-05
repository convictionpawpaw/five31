import { describe, it, expect } from 'vitest';
import {
  buildCycleWorkouts,
  cycleAdvancePlan,
  applyTmOverridePlan,
  addDeloadPlan,
  removeDeloadPlan,
  cycleWeeks,
} from '../cycle.ts';
import { DAY_ORDER } from '../scheme.ts';
import type { CycleLiftInput } from '../cycle.ts';
import type { LiftId, Workout } from '../types.ts';

const LB_LIFTS: Record<LiftId, CycleLiftInput> = {
  press: { tm: 120, increment: 5 },
  deadlift: { tm: 350, increment: 10 },
  bench: { tm: 200, increment: 5 },
  squat: { tm: 300, increment: 10 },
};

const INCREMENTS: Record<LiftId, number> = {
  press: 5,
  bench: 5,
  squat: 10,
  deadlift: 10,
};

// A deterministic id source: sequential ids so tests stay pure.
const seqIds = (n: number, prefix = 'w') =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('cycleWeeks', () => {
  it('includes the deload week only when requested', () => {
    expect(cycleWeeks(true)).toEqual([1, 2, 3, 4]);
    expect(cycleWeeks(false)).toEqual([1, 2, 3]);
  });
});

describe('buildCycleWorkouts', () => {
  it('produces 16 workouts with deload, 12 without', () => {
    const withDeload = buildCycleWorkouts({
      cycleId: 'c1',
      cycleNumber: 1,
      includeDeload: true,
      units: 'lb',
      lifts: LB_LIFTS,
      ids: seqIds(16),
    });
    expect(withDeload).toHaveLength(16);

    const noDeload = buildCycleWorkouts({
      cycleId: 'c1',
      cycleNumber: 1,
      includeDeload: false,
      units: 'lb',
      lifts: LB_LIFTS,
      ids: seqIds(12),
    });
    expect(noDeload).toHaveLength(12);
  });

  it('orders workouts by week then DAY_ORDER', () => {
    const ws = buildCycleWorkouts({
      cycleId: 'c1',
      cycleNumber: 1,
      includeDeload: true,
      units: 'lb',
      lifts: LB_LIFTS,
      ids: seqIds(16),
    });
    // Week 1 block is DAY_ORDER.
    expect(ws.slice(0, 4).map((w) => w.liftId)).toEqual([...DAY_ORDER]);
    expect(ws.slice(0, 4).map((w) => w.week)).toEqual([1, 1, 1, 1]);
    expect(ws.slice(4, 8).map((w) => w.week)).toEqual([2, 2, 2, 2]);
    expect(ws.slice(8, 12).map((w) => w.week)).toEqual([3, 3, 3, 3]);
    expect(ws.slice(12, 16).map((w) => w.week)).toEqual([4, 4, 4, 4]);
    expect(ws.slice(12, 16).map((w) => w.liftId)).toEqual([...DAY_ORDER]);
  });

  it('freezes tmUsed and main-set weights, all pending', () => {
    const ws = buildCycleWorkouts({
      cycleId: 'c1',
      cycleNumber: 1,
      includeDeload: false,
      units: 'lb',
      lifts: LB_LIFTS,
      ids: seqIds(12),
    });
    expect(ws.every((w) => w.status === 'pending')).toBe(true);
    expect(ws.every((w) => w.accessoryWork.length === 0)).toBe(true);

    const benchWk1 = ws.find((w) => w.liftId === 'bench' && w.week === 1)!;
    expect(benchWk1.tmUsed).toBe(200);
    const work = benchWk1.mainSets.filter((s) => s.kind === 'work');
    expect(work.map((s) => s.weight)).toEqual([130, 150, 170]);

    const pressWk3 = ws.find((w) => w.liftId === 'press' && w.week === 3)!;
    expect(pressWk3.tmUsed).toBe(120);
  });

  it('accepts a generator function as the id source', () => {
    let n = 0;
    const ws = buildCycleWorkouts({
      cycleId: 'c1',
      cycleNumber: 1,
      includeDeload: false,
      units: 'lb',
      lifts: LB_LIFTS,
      ids: () => `gen-${n++}`,
    });
    expect(ws[0]!.id).toBe('gen-0');
    expect(ws[11]!.id).toBe('gen-11');
    expect(new Set(ws.map((w) => w.id)).size).toBe(12); // unique
  });
});

// Helper: a completed AMRAP workout for a lift with a given actualReps.
function completedAmrap(
  liftId: LiftId,
  week: 1 | 2 | 3,
  targetReps: number,
  actualReps: number,
  id = `${liftId}-w${week}`,
): Workout {
  return {
    id,
    cycleId: 'c1',
    cycleNumber: 1,
    week,
    liftId,
    status: 'completed',
    tmUsed: 200,
    mainSets: [
      { kind: 'work', index: 0, percent: 0.75, weight: 150, targetReps: 5, amrap: false },
      {
        kind: 'work',
        index: 2,
        percent: 0.85,
        weight: 170,
        targetReps,
        amrap: true,
        actualReps,
      },
    ],
    accessoryWork: [],
    units: 'lb',
  };
}

describe('cycleAdvancePlan', () => {
  it('recommends increase for all lifts when every AMRAP met target', () => {
    const workouts: Workout[] = [
      completedAmrap('press', 1, 5, 6),
      completedAmrap('bench', 1, 5, 5),
      completedAmrap('squat', 1, 5, 8),
      completedAmrap('deadlift', 1, 5, 5),
    ];
    const plan = cycleAdvancePlan(workouts, {
      press: 120,
      bench: 200,
      squat: 300,
      deadlift: 350,
    }, INCREMENTS);

    const byLift = Object.fromEntries(plan.map((p) => [p.liftId, p]));
    expect(byLift.press!.recommendation).toBe('increase');
    expect(byLift.press!.recommendedTm).toBe(125); // +5
    expect(byLift.bench!.recommendedTm).toBe(205); // +5
    expect(byLift.squat!.recommendedTm).toBe(310); // +10
    expect(byLift.deadlift!.recommendedTm).toBe(360); // +10
  });

  it('recommends hold when any completed AMRAP fell short of target', () => {
    const workouts: Workout[] = [
      completedAmrap('press', 1, 5, 6),
      completedAmrap('press', 2, 3, 2, 'press-w2-fail'), // short → hold
      completedAmrap('bench', 1, 5, 5),
    ];
    const plan = cycleAdvancePlan(workouts, {
      press: 120,
      bench: 200,
      squat: 300,
      deadlift: 350,
    }, INCREMENTS);
    const byLift = Object.fromEntries(plan.map((p) => [p.liftId, p]));
    expect(byLift.press!.recommendation).toBe('hold');
    expect(byLift.press!.recommendedTm).toBe(120); // unchanged
    expect(byLift.bench!.recommendation).toBe('increase');
  });

  it('a SKIPPED workout does not cause a hold', () => {
    const skipped: Workout = { ...completedAmrap('squat', 2, 3, 1, 'squat-skip'), status: 'skipped' };
    const workouts: Workout[] = [completedAmrap('squat', 1, 5, 5), skipped];
    const plan = cycleAdvancePlan(workouts, {
      press: 120,
      bench: 200,
      squat: 300,
      deadlift: 350,
    }, INCREMENTS);
    const squat = plan.find((p) => p.liftId === 'squat')!;
    expect(squat.recommendation).toBe('increase');
    expect(squat.recommendedTm).toBe(310);
  });

  it('a PENDING workout does not cause a hold', () => {
    const pending: Workout = { ...completedAmrap('bench', 3, 1, 0, 'bench-pending'), status: 'pending' };
    const workouts: Workout[] = [completedAmrap('bench', 1, 5, 5), pending];
    const plan = cycleAdvancePlan(workouts, {
      press: 120,
      bench: 200,
      squat: 300,
      deadlift: 350,
    }, INCREMENTS);
    const bench = plan.find((p) => p.liftId === 'bench')!;
    expect(bench.recommendation).toBe('increase');
  });
});

describe('applyTmOverridePlan', () => {
  it('regenerates only the pending workouts of the targeted lift', () => {
    const ws = buildCycleWorkouts({
      cycleId: 'c1',
      cycleNumber: 1,
      includeDeload: false,
      units: 'lb',
      lifts: LB_LIFTS,
      ids: seqIds(12),
    });
    // Mark bench week-1 completed so it must NOT be regenerated.
    const benchWk1 = ws.find((w) => w.liftId === 'bench' && w.week === 1)!;
    benchWk1.status = 'completed';

    const plan = applyTmOverridePlan(ws, 'bench', 220, 5);
    // bench pending workouts: weeks 2 and 3 (week 1 completed).
    expect(plan.regeneratedWorkoutIds).toHaveLength(2);
    expect(plan.regeneratedWorkouts.every((w) => w.liftId === 'bench')).toBe(true);
    expect(plan.regeneratedWorkouts.every((w) => w.status === 'pending')).toBe(true);
    expect(plan.regeneratedWorkouts.every((w) => w.tmUsed === 220)).toBe(true);

    // Week 2 bench @ TM 220 → 0.7/0.8/0.9 = 154/176/198 (clean multiples of 2).
    const wk2 = plan.regeneratedWorkouts.find((w) => w.week === 2)!;
    expect(wk2.mainSets.filter((s) => s.kind === 'work').map((s) => s.weight)).toEqual([
      155, 175, 200,
    ]);
    // Other lifts untouched.
    expect(plan.regeneratedWorkouts.some((w) => w.liftId !== 'bench')).toBe(false);
  });
});

describe('deload add/remove plans', () => {
  it('addDeloadPlan generates 4 week-4 workouts in DAY_ORDER', () => {
    const noDeload = buildCycleWorkouts({
      cycleId: 'c1',
      cycleNumber: 1,
      includeDeload: false,
      units: 'lb',
      lifts: LB_LIFTS,
      ids: seqIds(12),
    });
    const plan = addDeloadPlan(noDeload, {
      cycleId: 'c1',
      cycleNumber: 1,
      units: 'lb',
      lifts: LB_LIFTS,
      ids: seqIds(4, 'd'),
    });
    expect(plan.addedWorkouts).toHaveLength(4);
    expect(plan.addedWorkouts.every((w) => w.week === 4)).toBe(true);
    expect(plan.addedWorkouts.map((w) => w.liftId)).toEqual([...DAY_ORDER]);
    // Deload has no warmups, no AMRAP.
    expect(plan.addedWorkouts.every((w) => w.mainSets.every((s) => s.kind === 'work'))).toBe(true);
    expect(plan.addedWorkouts.every((w) => w.mainSets.every((s) => !s.amrap))).toBe(true);
  });

  it('addDeloadPlan throws if a deload week already exists', () => {
    const withDeload = buildCycleWorkouts({
      cycleId: 'c1',
      cycleNumber: 1,
      includeDeload: true,
      units: 'lb',
      lifts: LB_LIFTS,
      ids: seqIds(16),
    });
    expect(() =>
      addDeloadPlan(withDeload, {
        cycleId: 'c1',
        cycleNumber: 1,
        units: 'lb',
        lifts: LB_LIFTS,
        ids: seqIds(4, 'd'),
      }),
    ).toThrow();
  });

  it('removeDeloadPlan returns the 4 week-4 ids when all pending', () => {
    const withDeload = buildCycleWorkouts({
      cycleId: 'c1',
      cycleNumber: 1,
      includeDeload: true,
      units: 'lb',
      lifts: LB_LIFTS,
      ids: seqIds(16),
    });
    const plan = removeDeloadPlan(withDeload);
    expect(plan.removedWorkoutIds).toHaveLength(4);
  });

  it('removeDeloadPlan throws if any week-4 workout has started', () => {
    const withDeload = buildCycleWorkouts({
      cycleId: 'c1',
      cycleNumber: 1,
      includeDeload: true,
      units: 'lb',
      lifts: LB_LIFTS,
      ids: seqIds(16),
    });
    withDeload.find((w) => w.week === 4)!.status = 'in_progress';
    expect(() => removeDeloadPlan(withDeload)).toThrow();
  });
});
