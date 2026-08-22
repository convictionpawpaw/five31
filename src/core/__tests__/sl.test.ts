import { describe, it, expect } from 'vitest';
import {
  SL_SESSIONS_PER_CYCLE,
  SL_SLOT_LIFTS,
  SL_LIFTS,
  bestSlE1rm,
  buildSlCycleState,
  buildSlCycleWorkouts,
  buildSlMainSets,
  defaultSlIncrements,
  evaluateSlLiftPass,
  projectSlWeight,
  slProgressionStep,
  slReturnTmSuggestions,
  slSetCount,
  slSlotForSession,
  slSwitchInSuggestions,
  slWeekForSession,
} from '../sl.ts';
import { effortSet } from '../efforts.ts';
import { buildCycleWorkouts } from '../cycle.ts';
import { epley } from '../e1rm.ts';
import { DAY_ORDER } from '../scheme.ts';
import type { CycleLiftInput } from '../cycle.ts';
import type { LiftId, MainSet, SlLiftId, SlLiftRuntime, Workout } from '../types.ts';
// Core tests may reach outside core (the purity rule ignores __tests__): this
// pins effortSet's 5/3/1 branch against the CLASSIC extraction it must match.
import { amrapSet } from '../../features/shared/workoutSelect.ts';

const seqIds = (n: number, prefix = 'w') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

const runtime = (weight: number, increment: number, failStreak = 0): SlLiftRuntime => ({
  weight,
  increment,
  failStreak,
});

// ---------------------------------------------------------------------------
// Session math
// ---------------------------------------------------------------------------

describe('slSlotForSession', () => {
  it('starts on A and alternates every session', () => {
    const slots = Array.from({ length: SL_SESSIONS_PER_CYCLE }, (_, i) => slSlotForSession(i + 1));
    expect(slots).toEqual(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B']);
  });

  it('rejects sessions outside 1..12 and non-integers', () => {
    expect(() => slSlotForSession(0)).toThrow(/out of range/);
    expect(() => slSlotForSession(13)).toThrow(/out of range/);
    expect(() => slSlotForSession(1.5)).toThrow(/out of range/);
  });
});

describe('slWeekForSession', () => {
  it('maps 3 sessions to each of the 4 weeks', () => {
    const weeks = Array.from({ length: SL_SESSIONS_PER_CYCLE }, (_, i) => slWeekForSession(i + 1));
    expect(weeks).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
  });

  it('FOOTGUN: sessions 10–12 carry week === 4, which is the 5/3/1 DELOAD week', () => {
    // Deload add/remove operate on week-4 rows; on an SL cycle that would delete
    // the last third of the block. Pinned here so the guard work stays honest.
    expect(slWeekForSession(10)).toBe(4);
    expect(slWeekForSession(12)).toBe(4);
  });

  it('rejects sessions outside 1..12', () => {
    expect(() => slWeekForSession(0)).toThrow(/out of range/);
    expect(() => slWeekForSession(13)).toThrow(/out of range/);
  });
});

describe('SL_SLOT_LIFTS', () => {
  it('is A = squat/bench/row and B = squat/press/deadlift', () => {
    expect(SL_SLOT_LIFTS.A).toEqual(['squat', 'bench', 'row']);
    expect(SL_SLOT_LIFTS.B).toEqual(['squat', 'press', 'deadlift']);
  });

  it('squats every session, squat first', () => {
    expect(SL_SLOT_LIFTS.A[0]).toBe('squat');
    expect(SL_SLOT_LIFTS.B[0]).toBe('squat');
  });

  it('covers all five tracked lifts exactly once across the two slots', () => {
    const all = [...SL_SLOT_LIFTS.A, ...SL_SLOT_LIFTS.B].filter((l) => l !== 'squat');
    expect(new Set([...all, 'squat'])).toEqual(new Set(SL_LIFTS));
    expect(SL_LIFTS).toHaveLength(5);
  });
});

describe('slSetCount', () => {
  it('is 5×5 for everything but the deadlift, which is 1×5', () => {
    expect(slSetCount('squat')).toBe(5);
    expect(slSetCount('bench')).toBe(5);
    expect(slSetCount('row')).toBe(5);
    expect(slSetCount('press')).toBe(5);
    expect(slSetCount('deadlift')).toBe(1);
  });
});

describe('defaultSlIncrements', () => {
  it('lb: 5 everywhere, 10 for the deadlift', () => {
    expect(defaultSlIncrements('lb')).toEqual({
      squat: 5,
      bench: 5,
      row: 5,
      press: 5,
      deadlift: 10,
    });
  });

  it('kg: 2.5 everywhere, 5 for the deadlift', () => {
    expect(defaultSlIncrements('kg')).toEqual({
      squat: 2.5,
      bench: 2.5,
      row: 2.5,
      press: 2.5,
      deadlift: 5,
    });
  });
});

// ---------------------------------------------------------------------------
// Set + workout generation
// ---------------------------------------------------------------------------

describe('buildSlMainSets', () => {
  it('builds 5 straight work sets of 5 at the working weight', () => {
    const sets = buildSlMainSets(185, 'squat');
    expect(sets).toHaveLength(5);
    expect(sets.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    for (const s of sets) {
      expect(s.kind).toBe('work');
      expect(s.percent).toBe(1);
      expect(s.weight).toBe(185);
      expect(s.targetReps).toBe(5);
      expect(s.amrap).toBe(false);
      expect(s.actualReps).toBeUndefined();
    }
  });

  it('builds a single 1×5 set for the deadlift', () => {
    const sets = buildSlMainSets(300, 'deadlift');
    expect(sets).toHaveLength(1);
    expect(sets[0]!.index).toBe(0);
    expect(sets[0]!.targetReps).toBe(5);
    expect(sets[0]!.amrap).toBe(false);
  });

  it('has no warmup sets at all', () => {
    expect(buildSlMainSets(95, 'press').some((s) => s.kind === 'warmup')).toBe(false);
  });
});

describe('buildSlCycleWorkouts', () => {
  const build = (ids = seqIds(36)) =>
    buildSlCycleWorkouts({ cycleId: 'c-sl', cycleNumber: 7, units: 'lb', ids });

  it('produces 36 pending rows — 12 sessions × 3 lifts', () => {
    const ws = build();
    expect(ws).toHaveLength(36);
    expect(ws.every((w) => w.status === 'pending')).toBe(true);
  });

  it('leaves weights LAZY: empty mainSets and tmUsed 0', () => {
    const ws = build();
    expect(ws.every((w) => w.mainSets.length === 0)).toBe(true);
    expect(ws.every((w) => w.tmUsed === 0)).toBe(true);
  });

  it('carries no accessory work and stamps the SL program fields', () => {
    const ws = build();
    expect(ws.every((w) => w.accessoryWork.length === 0)).toBe(true);
    expect(ws.every((w) => w.program === 'sl5x5')).toBe(true);
    expect(ws.every((w) => w.units === 'lb')).toBe(true);
    expect(ws.every((w) => w.cycleId === 'c-sl' && w.cycleNumber === 7)).toBe(true);
  });

  it('emits sessions in order with squat first within each session', () => {
    const ws = build();
    expect(ws.slice(0, 3).map((w) => w.liftId)).toEqual(['squat', 'bench', 'row']);
    expect(ws.slice(3, 6).map((w) => w.liftId)).toEqual(['squat', 'press', 'deadlift']);
    expect(ws.slice(0, 3).every((w) => w.session === 1 && w.slSlot === 'A')).toBe(true);
    expect(ws.slice(3, 6).every((w) => w.session === 2 && w.slSlot === 'B')).toBe(true);
  });

  it('agrees with the session→week/slot maps on every row', () => {
    for (const w of build()) {
      expect(w.week).toBe(slWeekForSession(w.session!));
      expect(w.slSlot).toBe(slSlotForSession(w.session!));
      expect(SL_SLOT_LIFTS[w.slSlot!]).toContain(w.liftId);
    }
  });

  it('consumes the provided ids in generation order (deterministic)', () => {
    const ws = build();
    expect(ws.map((w) => w.id)).toEqual(seqIds(36));
  });

  it('accepts a generator id source', () => {
    let n = 0;
    const ws = buildSlCycleWorkouts({
      cycleId: 'c',
      cycleNumber: 1,
      units: 'kg',
      ids: () => `g${n++}`,
    });
    expect(ws[0]!.id).toBe('g0');
    expect(ws[35]!.id).toBe('g35');
  });

  it('throws when too few ids are supplied', () => {
    expect(() => build(seqIds(35))).toThrow(/not enough ids/);
  });
});

// ---------------------------------------------------------------------------
// Pass / fail evaluation
// ---------------------------------------------------------------------------

describe('evaluateSlLiftPass', () => {
  const logged = (reps: (number | undefined)[]): MainSet[] =>
    reps.map((r, i) => ({
      kind: 'work' as const,
      index: i,
      percent: 1,
      weight: 185,
      targetReps: 5,
      amrap: false,
      ...(r === undefined ? {} : { actualReps: r }),
    }));

  it('passes when every work set hits its target', () => {
    expect(evaluateSlLiftPass(logged([5, 5, 5, 5, 5]))).toBe(true);
  });

  it('passes when sets exceed the target', () => {
    expect(evaluateSlLiftPass(logged([6, 5, 5, 5, 7]))).toBe(true);
  });

  it('fails when any set falls short', () => {
    expect(evaluateSlLiftPass(logged([5, 5, 5, 5, 4]))).toBe(false);
    expect(evaluateSlLiftPass(logged([3, 5, 5, 5, 5]))).toBe(false);
  });

  it('treats an UNLOGGED set as a miss', () => {
    expect(evaluateSlLiftPass(logged([5, 5, 5, 5, undefined]))).toBe(false);
    expect(
      evaluateSlLiftPass(logged([undefined, undefined, undefined, undefined, undefined])),
    ).toBe(false);
  });

  it('never passes a row with no work sets (unstamped)', () => {
    expect(evaluateSlLiftPass([])).toBe(false);
  });

  it('evaluates the deadlift on its single set', () => {
    expect(evaluateSlLiftPass(logged([5]))).toBe(true);
    expect(evaluateSlLiftPass(logged([4]))).toBe(false);
  });

  it('ignores warmup sets if any are present', () => {
    const sets: MainSet[] = [
      { kind: 'warmup', index: 0, percent: 0.4, weight: 75, targetReps: 5, amrap: false },
      ...logged([5, 5, 5, 5, 5]),
    ];
    expect(evaluateSlLiftPass(sets)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Progression (all plan §2 vectors)
// ---------------------------------------------------------------------------

describe('slProgressionStep', () => {
  it('vector: 225 pass +5 → 230, streak cleared', () => {
    expect(slProgressionStep(runtime(225, 5), true, 5)).toEqual(runtime(230, 5, 0));
  });

  it('vector: deadlift 300 pass +10 → 310', () => {
    expect(slProgressionStep(runtime(300, 10), true, 5)).toEqual(runtime(310, 10, 0));
  });

  it('a pass clears an existing fail streak', () => {
    expect(slProgressionStep(runtime(225, 5, 2), true, 5)).toEqual(runtime(230, 5, 0));
  });

  it('vector: 185 miss #1 → repeat 185, streak 1', () => {
    expect(slProgressionStep(runtime(185, 5), false, 5)).toEqual(runtime(185, 5, 1));
  });

  it('miss #2 → repeat 185, streak 2 (no deload yet)', () => {
    expect(slProgressionStep(runtime(185, 5, 1), false, 5)).toEqual(runtime(185, 5, 2));
  });

  it('vector: 185 miss #3, inc 5 → 166.5 rounds to 165, streak cleared', () => {
    expect(slProgressionStep(runtime(185, 5, 2), false, 5)).toEqual(runtime(165, 5, 0));
  });

  it('vector (tie rounds UP): 225 miss #3 → 202.5 → 205', () => {
    expect(slProgressionStep(runtime(225, 5, 2), false, 5).weight).toBe(205);
  });

  it('vector (tie rounds DOWN-side): 95 miss #3 → 85.5 → 85', () => {
    expect(slProgressionStep(runtime(95, 5, 2), false, 5).weight).toBe(85);
  });

  it('vector (kg): 60 miss #3, inc 2.5 → 54 → 55', () => {
    expect(slProgressionStep(runtime(60, 2.5, 2), false, 2.5)).toEqual(runtime(55, 2.5, 0));
  });

  it('deloads on the ROUNDING increment, not the lift increment', () => {
    // deadlift: lift increment 10, rounding increment 5 → 300 × 0.9 = 270.
    expect(slProgressionStep(runtime(300, 10, 2), false, 5).weight).toBe(270);
  });

  it('is pure — never mutates the state it is given', () => {
    const state = runtime(185, 5, 2);
    slProgressionStep(state, false, 5);
    expect(state).toEqual(runtime(185, 5, 2));
  });
});

describe('projectSlWeight', () => {
  it('adds one increment per intervening session', () => {
    const sq = runtime(225, 5);
    expect(projectSlWeight(sq, 0)).toBe(225);
    expect(projectSlWeight(sq, 1)).toBe(230);
    expect(projectSlWeight(sq, 4)).toBe(245);
  });

  it('uses the per-lift increment (deadlift +10)', () => {
    expect(projectSlWeight(runtime(300, 10), 3)).toBe(330);
  });
});

// ---------------------------------------------------------------------------
// Switching in / out
// ---------------------------------------------------------------------------

describe('slSwitchInSuggestions', () => {
  it('vectors (lb, increment 5): 85% of TM, rounded', () => {
    const tms: Record<LiftId, number> = { press: 120, deadlift: 350, bench: 200, squat: 265 };
    expect(slSwitchInSuggestions(tms, 5)).toEqual({
      press: 100, // 102 → 100
      deadlift: 300, // 297.5 → tie rounds UP → 300
      bench: 170, // 170 exactly
      squat: 225, // 225.25 → 225
    });
  });

  it('vector (kg, increment 2.5): TM 102.5 → 87.5', () => {
    const tms: Record<LiftId, number> = {
      press: 102.5,
      deadlift: 102.5,
      bench: 102.5,
      squat: 102.5,
    };
    expect(slSwitchInSuggestions(tms, 2.5).press).toBe(87.5);
  });

  it('covers exactly the four 5/3/1 lifts (the row is entered fresh)', () => {
    const out = slSwitchInSuggestions({ press: 100, deadlift: 100, bench: 100, squat: 100 }, 5);
    expect(Object.keys(out).sort()).toEqual(['bench', 'deadlift', 'press', 'squat']);
  });
});

describe('bestSlE1rm', () => {
  it('takes the maximum Epley estimate across efforts', () => {
    expect(
      bestSlE1rm([
        { weight: 200, reps: 5 },
        { weight: 240, reps: 5 },
      ]),
    ).toBe(epley(240, 5));
  });

  it('is null with no efforts, and skips efforts with no valid estimate', () => {
    expect(bestSlE1rm([])).toBeNull();
    expect(bestSlE1rm([{ weight: 200, reps: 0 }])).toBeNull();
    expect(
      bestSlE1rm([
        { weight: 200, reps: 0 },
        { weight: 100, reps: 5 },
      ]),
    ).toBe(epley(100, 5));
  });
});

describe('slReturnTmSuggestions', () => {
  const currentTms: Record<LiftId, number> = { press: 120, deadlift: 350, bench: 200, squat: 265 };

  it('vector: squat best 240×5 → e1RM 280 → 252 → 250 < TM 265, so the TM is KEPT', () => {
    const best: Record<LiftId, number | null> = {
      press: null,
      deadlift: null,
      bench: null,
      squat: epley(240, 5),
    };
    const squat = slReturnTmSuggestions(currentTms, best, 5).find((s) => s.liftId === 'squat')!;
    expect(squat.bestE1rm).toBe(280);
    expect(squat.e1rmDerivedTm).toBe(250);
    expect(squat.suggestedTm).toBe(265);
    expect(squat.basis).toBe('current-tm');
  });

  it('vector: bench best 205×5 → e1RM 239.2 → 215.28 → 215 > TM 200, so the TM is RAISED', () => {
    const best: Record<LiftId, number | null> = {
      press: null,
      deadlift: null,
      bench: epley(205, 5),
      squat: null,
    };
    const bench = slReturnTmSuggestions(currentTms, best, 5).find((s) => s.liftId === 'bench')!;
    expect(bench.bestE1rm).toBe(239.2);
    expect(bench.e1rmDerivedTm).toBe(215);
    expect(bench.suggestedTm).toBe(215);
    expect(bench.basis).toBe('sl-e1rm');
  });

  it('keeps the current TM when the block produced no usable efforts', () => {
    const none: Record<LiftId, number | null> = {
      press: null,
      deadlift: null,
      bench: null,
      squat: null,
    };
    const out = slReturnTmSuggestions(currentTms, none, 5);
    expect(out.map((s) => s.suggestedTm)).toEqual(out.map((s) => s.currentTm));
    expect(out.every((s) => s.basis === 'current-tm' && s.e1rmDerivedTm === null)).toBe(true);
  });

  it('never lowers a TM', () => {
    const weak: Record<LiftId, number | null> = {
      press: 50,
      deadlift: 50,
      bench: 50,
      squat: 50,
    };
    const out = slReturnTmSuggestions(currentTms, weak, 5);
    expect(out.every((s) => s.suggestedTm >= s.currentTm)).toBe(true);
  });

  it('returns the four main lifts in DAY_ORDER (never the row)', () => {
    const none: Record<LiftId, number | null> = {
      press: null,
      deadlift: null,
      bench: null,
      squat: null,
    };
    expect(slReturnTmSuggestions(currentTms, none, 5).map((s) => s.liftId)).toEqual([...DAY_ORDER]);
  });
});

describe('buildSlCycleState', () => {
  it('builds all five lifts with zeroed fail streaks', () => {
    const weights: Record<SlLiftId, number> = {
      squat: 225,
      bench: 170,
      row: 135,
      press: 100,
      deadlift: 300,
    };
    const state = buildSlCycleState(weights, defaultSlIncrements('lb'), true);
    expect(Object.keys(state.lifts).sort()).toEqual(['bench', 'deadlift', 'press', 'row', 'squat']);
    expect(state.lifts.deadlift).toEqual(runtime(300, 10, 0));
    expect(state.lifts.row).toEqual(runtime(135, 5, 0));
    expect(state.keepPrs).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// effortSet — the PR effort, per program
// ---------------------------------------------------------------------------

const LB_LIFTS: Record<LiftId, CycleLiftInput> = {
  press: { tm: 120, increment: 5 },
  deadlift: { tm: 350, increment: 10 },
  bench: { tm: 200, increment: 5 },
  squat: { tm: 300, increment: 10 },
};

/** A real classic 5/3/1 workout for the requested week. */
function classicWorkout(week: 1 | 2 | 3 | 4): Workout {
  const ws = buildCycleWorkouts({
    cycleId: 'c1',
    cycleNumber: 1,
    includeDeload: true,
    units: 'lb',
    lifts: LB_LIFTS,
    ids: seqIds(16),
    weeks: [week],
  });
  return ws[0]!;
}

/** An SL row with the given reps logged against a 5×5 at `weight`. */
function slWorkout(
  weight: number,
  reps: (number | undefined)[],
  liftId: SlLiftId = 'squat',
): Workout {
  const base = buildSlCycleWorkouts({
    cycleId: 'c-sl',
    cycleNumber: 2,
    units: 'lb',
    ids: seqIds(36),
  })[0]!;
  const mainSets = buildSlMainSets(weight, liftId).map((s, i) => {
    const r = reps[i];
    return r === undefined ? s : { ...s, actualReps: r };
  });
  return { ...base, liftId, tmUsed: weight, mainSets, status: 'completed' };
}

describe('effortSet — 5/3/1 rows', () => {
  it('returns the AMRAP work set for weeks 1–3', () => {
    for (const week of [1, 2, 3] as const) {
      const w = classicWorkout(week);
      const set = effortSet(w);
      expect(set).not.toBeNull();
      expect(set!.amrap).toBe(true);
      expect(set!.kind).toBe('work');
    }
  });

  it('is byte-compatible with the classic amrapSet extraction (same set object)', () => {
    for (const week of [1, 2, 3, 4] as const) {
      const w = classicWorkout(week);
      expect(effortSet(w)).toBe(amrapSet(w));
    }
  });

  it('returns the AMRAP set even when it is unlogged (callers check actualReps)', () => {
    const w = classicWorkout(1);
    expect(effortSet(w)!.actualReps).toBeUndefined();
  });

  it('has no effort on a deload week', () => {
    expect(effortSet(classicWorkout(4))).toBeNull();
  });
});

describe('effortSet — StrongLifts rows', () => {
  it('returns the logged work set with the highest e1RM', () => {
    const w = slWorkout(185, [5, 5, 5, 5, 8]);
    expect(effortSet(w)!.index).toBe(4); // 8 reps beats every 5-rep set
  });

  it('breaks ties on the FIRST set', () => {
    const w = slWorkout(185, [5, 5, 5, 5, 5]);
    expect(effortSet(w)!.index).toBe(0);
  });

  it('ignores unlogged sets', () => {
    const w = slWorkout(185, [3, undefined, undefined, undefined, undefined]);
    expect(effortSet(w)!.index).toBe(0);
    expect(effortSet(w)!.actualReps).toBe(3);
  });

  it('is null when nothing usable was logged', () => {
    expect(effortSet(slWorkout(185, []))).toBeNull();
    expect(effortSet(slWorkout(185, [0, 0, 0, 0, 0]))).toBeNull();
  });

  it('never returns an AMRAP set, because SL rows have none', () => {
    const w = slWorkout(185, [5, 5, 5, 5, 5]);
    expect(w.mainSets.every((s) => !s.amrap)).toBe(true);
    expect(effortSet(w)!.amrap).toBe(false);
  });

  it('works for the single-set deadlift', () => {
    const w = slWorkout(300, [5], 'deadlift');
    expect(effortSet(w)!.index).toBe(0);
    expect(epley(effortSet(w)!.weight, effortSet(w)!.actualReps!)).toBe(epley(300, 5));
  });
});
