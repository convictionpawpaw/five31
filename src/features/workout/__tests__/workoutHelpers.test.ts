import { describe, it, expect } from 'vitest';
import type { AccessoryWork, LiftId, MainSet, Units, Workout, WorkoutStatus } from '../../../core/types.ts';
import { bestE1rmForLift, countUnloggedSets, workoutSetPr } from '../workoutHelpers.ts';
import { epley } from '../../../core/e1rm.ts';

function work(index: number, weight: number, targetReps: number, amrap = false, actualReps?: number): MainSet {
  return { kind: 'work', index, percent: 0.85, weight, targetReps, amrap, actualReps };
}
function warm(index: number, weight: number): MainSet {
  return { kind: 'warmup', index, percent: 0.4, weight, targetReps: 5, amrap: false };
}

function acc(setReps: (number | null)[], targetSets = setReps.length): AccessoryWork {
  return {
    accessoryId: 'a1',
    name: 'Chins',
    weight: 0,
    targetSets,
    repRangeMin: 8,
    repRangeMax: 12,
    setReps,
    progressed: false,
  };
}

function mk(
  id: string,
  liftId: LiftId,
  status: WorkoutStatus,
  mainSets: MainSet[],
  extra: Partial<Workout> = {},
): Workout {
  return {
    id,
    cycleId: 'c1',
    cycleNumber: 1,
    week: 1,
    liftId,
    status,
    tmUsed: 200,
    mainSets,
    accessoryWork: [],
    units: 'lb' as Units,
    ...extra,
  };
}

describe('countUnloggedSets', () => {
  it('counts unlogged work sets and accessory sets, ignoring warmups', () => {
    const w = mk('a', 'press', 'in_progress', [
      warm(0, 80),
      work(0, 130, 5, false, 5),
      work(1, 150, 5),
      work(2, 170, 5, true),
    ]);
    w.accessoryWork = [acc([12, null, null])];
    // work: index1 + index2 unlogged = 2; accessory: 2 nulls = 2; warmup ignored.
    expect(countUnloggedSets(w)).toBe(4);
  });

  it('is zero when all work + accessory sets are logged', () => {
    const w = mk('a', 'press', 'in_progress', [work(0, 130, 5, false, 5), work(1, 170, 5, true, 8)]);
    w.accessoryWork = [acc([12, 12])];
    expect(countUnloggedSets(w)).toBe(0);
  });
});

describe('bestE1rmForLift', () => {
  it('takes the running max e1RM across completed AMRAP efforts of the lift', () => {
    const w1 = mk('w1', 'press', 'completed', [work(0, 170, 5, true, 5)], {
      completedAt: '2026-01-01T00:00:00Z',
    });
    const w2 = mk('w2', 'press', 'completed', [work(0, 180, 5, true, 3)], {
      completedAt: '2026-01-08T00:00:00Z',
    });
    // e1RM(170,5)=198.3 ; e1RM(180,3)=198.0 → best = 198.3
    const best = bestE1rmForLift([w1, w2], 'press', 'lb');
    expect(best).toBeCloseTo(198.3, 1);
  });

  it('excludes the current workout by id', () => {
    const w1 = mk('w1', 'press', 'completed', [work(0, 170, 5, true, 5)], {
      completedAt: '2026-01-01T00:00:00Z',
    });
    const cur = mk('cur', 'press', 'completed', [work(0, 300, 5, true, 10)], {
      completedAt: '2026-01-08T00:00:00Z',
    });
    const best = bestE1rmForLift([w1, cur], 'press', 'lb', 'cur');
    expect(best).toBeCloseTo(epley(170, 5)!, 1);
  });

  it('converts cross-unit efforts into the target units', () => {
    // A kg effort compared in lb should convert up.
    const kg = mk('kg', 'press', 'completed', [work(0, 100, 3, true, 5)], {
      completedAt: '2026-01-01T00:00:00Z',
      units: 'kg',
    });
    const best = bestE1rmForLift([kg], 'press', 'lb');
    // 100 kg → ~220.46 lb; e1RM at 5 reps.
    const expected = epley(100 / 0.45359237, 5)!;
    expect(best).toBeCloseTo(expected, 1);
  });

  it('returns null when no completed AMRAP efforts exist', () => {
    const pending = mk('p', 'press', 'pending', [work(0, 170, 5, true)]);
    expect(bestE1rmForLift([pending], 'press', 'lb')).toBeNull();
  });
});

describe('workoutSetPr', () => {
  it('flags the workout whose AMRAP e1RM is the running max', () => {
    const w1 = mk('w1', 'press', 'completed', [work(0, 170, 5, true, 5)], {
      completedAt: '2026-01-01T00:00:00Z',
    });
    const w2 = mk('w2', 'press', 'completed', [work(0, 185, 5, true, 5)], {
      completedAt: '2026-01-08T00:00:00Z',
    });
    expect(workoutSetPr([w1, w2], w2)).toBe(true);
    expect(workoutSetPr([w1, w2], w1)).toBe(true); // first is always a PR
  });

  it('is false for a later effort that did not beat the record', () => {
    const w1 = mk('w1', 'press', 'completed', [work(0, 185, 5, true, 8)], {
      completedAt: '2026-01-01T00:00:00Z',
    });
    const w2 = mk('w2', 'press', 'completed', [work(0, 170, 5, true, 3)], {
      completedAt: '2026-01-08T00:00:00Z',
    });
    expect(workoutSetPr([w1, w2], w2)).toBe(false);
  });
});
