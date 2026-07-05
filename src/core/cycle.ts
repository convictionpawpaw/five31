import type { LiftId, MainSet, WeekNumber, Workout } from './types.ts';
import { DAY_ORDER } from './scheme.ts';
import { buildMainSets } from './setCalc.ts';

/** The weeks in a cycle, with or without the optional deload week. */
export function cycleWeeks(includeDeload: boolean): WeekNumber[] {
  return includeDeload ? [1, 2, 3, 4] : [1, 2, 3];
}

/** Per-lift inputs needed to generate a cycle's workouts. */
export interface CycleLiftInput {
  tm: number;
  increment: number; // rounding/lift increment used for weight rounding
}

export interface BuildCycleWorkoutsArgs {
  cycleId: string;
  cycleNumber: number;
  includeDeload: boolean;
  units: 'lb' | 'kg';
  /** TM + increment per lift; TMs are frozen into each generated workout. */
  lifts: Record<LiftId, CycleLiftInput>;
  /**
   * Deterministic id source. Either a generator called once per workout, or a
   * pre-made list of ids (one per workout, in generation order). Providing ids
   * keeps the function pure and fully testable.
   */
  ids: (() => string) | readonly string[];
  /**
   * Explicit weeks to generate. Defaults to the full cycle (from `includeDeload`).
   * Used by `addDeloadPlan` to generate only the deload week.
   */
  weeks?: readonly WeekNumber[];
}

/**
 * Build all workouts for a cycle as `pending`, ordered by week then DAY_ORDER,
 * with every main-set weight and `tmUsed` frozen at generation. Accessory work
 * is left empty here (stamped lazily when a workout transitions to in_progress).
 *
 * Produces 12 workouts without deload, 16 with.
 */
export function buildCycleWorkouts(args: BuildCycleWorkoutsArgs): Workout[] {
  const { cycleId, cycleNumber, includeDeload, units, lifts, ids } = args;
  const weeks = args.weeks ?? cycleWeeks(includeDeload);

  let cursor = 0;
  const nextId = (): string => {
    if (typeof ids === 'function') return ids();
    const id = ids[cursor];
    if (id === undefined) {
      throw new Error(`buildCycleWorkouts: not enough ids provided (needed index ${cursor})`);
    }
    cursor += 1;
    return id;
  };

  const workouts: Workout[] = [];
  for (const week of weeks) {
    for (const liftId of DAY_ORDER) {
      const input = lifts[liftId];
      const mainSets: MainSet[] = buildMainSets(input.tm, week, input.increment);
      workouts.push({
        id: nextId(),
        cycleId,
        cycleNumber,
        week,
        liftId,
        status: 'pending',
        tmUsed: input.tm,
        mainSets,
        accessoryWork: [],
        units,
      });
    }
  }

  return workouts;
}

// ---------------------------------------------------------------------------
// Cycle advance
// ---------------------------------------------------------------------------

export type AdvanceRecommendation = 'increase' | 'hold';

export interface AdvancePlanEntry {
  liftId: LiftId;
  currentTm: number;
  recommendation: AdvanceRecommendation;
  increment: number;
  /** TM the recommendation would produce (currentTm, or currentTm + increment). */
  recommendedTm: number;
}

/**
 * Compute the per-lift TM advance recommendation for a finished cycle.
 *
 * Rule: recommend `hold` for a lift if ANY of its COMPLETED week-1..3 AMRAP sets
 * fell short of the target reps (actualReps < targetReps). Otherwise recommend
 * `increase` by the lift's increment. Skipped workouts (and the deload week) are
 * ignored — a skip never forces a hold.
 */
export function cycleAdvancePlan(
  workouts: readonly Workout[],
  currentTms: Record<LiftId, number>,
  increments: Record<LiftId, number>,
): AdvancePlanEntry[] {
  return DAY_ORDER.map((liftId): AdvancePlanEntry => {
    const currentTm = currentTms[liftId];
    const increment = increments[liftId];

    let hold = false;
    for (const w of workouts) {
      if (w.liftId !== liftId) continue;
      if (w.status !== 'completed') continue; // skipped/pending ignored
      if (w.week === 4) continue; // deload has no AMRAP
      for (const set of w.mainSets) {
        if (!set.amrap) continue;
        if (set.actualReps !== undefined && set.actualReps < set.targetReps) {
          hold = true;
        }
      }
    }

    const recommendation: AdvanceRecommendation = hold ? 'hold' : 'increase';
    const recommendedTm = recommendation === 'increase' ? currentTm + increment : currentTm;
    return { liftId, currentTm, recommendation, increment, recommendedTm };
  });
}

// ---------------------------------------------------------------------------
// Mid-cycle TM override
// ---------------------------------------------------------------------------

export interface TmOverridePlan {
  liftId: LiftId;
  newTm: number;
  /** Ids of the pending workouts that will be regenerated. */
  regeneratedWorkoutIds: string[];
  /** The regenerated workouts (pending only), with frozen new weights + tmUsed. */
  regeneratedWorkouts: Workout[];
}

/**
 * Plan a mid-cycle TM override for a single lift: regenerate the main sets of
 * only that lift's PENDING workouts using the new TM. Completed/in_progress/
 * skipped workouts are never touched (history-integrity invariant #1).
 */
export function applyTmOverridePlan(
  workouts: readonly Workout[],
  liftId: LiftId,
  newTm: number,
  increment: number,
): TmOverridePlan {
  const regeneratedWorkouts: Workout[] = [];
  const regeneratedWorkoutIds: string[] = [];

  for (const w of workouts) {
    if (w.liftId !== liftId) continue;
    if (w.status !== 'pending') continue;
    const mainSets = buildMainSets(newTm, w.week, increment);
    regeneratedWorkouts.push({ ...w, tmUsed: newTm, mainSets });
    regeneratedWorkoutIds.push(w.id);
  }

  return { liftId, newTm, regeneratedWorkoutIds, regeneratedWorkouts };
}

// ---------------------------------------------------------------------------
// Deload add / remove (per-cycle)
// ---------------------------------------------------------------------------

export interface DeloadAddPlan {
  addedWorkouts: Workout[];
}

/**
 * Plan adding a deload week to a cycle that currently has none: generate the 4
 * week-4 workouts (DAY_ORDER) as pending with frozen weights. Fails if the cycle
 * already has any week-4 workout.
 */
export function addDeloadPlan(
  workouts: readonly Workout[],
  args: {
    cycleId: string;
    cycleNumber: number;
    units: 'lb' | 'kg';
    lifts: Record<LiftId, CycleLiftInput>;
    ids: (() => string) | readonly string[];
  },
): DeloadAddPlan {
  if (workouts.some((w) => w.week === 4)) {
    throw new Error('addDeloadPlan: cycle already has a deload week');
  }
  const built = buildCycleWorkouts({
    cycleId: args.cycleId,
    cycleNumber: args.cycleNumber,
    includeDeload: true,
    units: args.units,
    lifts: args.lifts,
    ids: args.ids,
    weeks: [4], // generate only the deload week (consumes exactly 4 ids)
  });
  return { addedWorkouts: built };
}

export interface DeloadRemovePlan {
  removedWorkoutIds: string[];
}

/**
 * Plan removing a cycle's deload week. Only allowed while ALL four week-4
 * workouts are still pending (none started/completed/skipped). Returns the ids
 * to delete. Throws if any week-4 workout is not pending.
 */
export function removeDeloadPlan(workouts: readonly Workout[]): DeloadRemovePlan {
  const week4 = workouts.filter((w) => w.week === 4);
  if (week4.length === 0) {
    throw new Error('removeDeloadPlan: cycle has no deload week');
  }
  if (week4.some((w) => w.status !== 'pending')) {
    throw new Error('removeDeloadPlan: cannot remove a deload week that has started');
  }
  return { removedWorkoutIds: week4.map((w) => w.id) };
}
