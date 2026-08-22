import type {
  LiftId,
  MainSet,
  SlCycleState,
  SlLiftId,
  SlLiftRuntime,
  SlSlot,
  Units,
  WeekNumber,
  Workout,
} from './types.ts';
import { DAY_ORDER } from './scheme.ts';
import { roundToIncrement } from './rounding.ts';
import { epley } from './e1rm.ts';

// ---------------------------------------------------------------------------
// Session math
// ---------------------------------------------------------------------------

/** A StrongLifts block is 4 weeks × 3 sessions. */
export const SL_SESSIONS_PER_CYCLE = 12;

/** Sessions per week — StrongLifts is trained 3×/week. */
export const SL_SESSIONS_PER_WEEK = 3;

/**
 * Which lifts each alternating workout trains, in the order they are performed.
 * Squat leads BOTH sessions (it is trained every session, the canon rule).
 */
export const SL_SLOT_LIFTS: Record<SlSlot, readonly SlLiftId[]> = {
  A: ['squat', 'bench', 'row'],
  B: ['squat', 'press', 'deadlift'],
} as const;

/** Every lift a StrongLifts block can train (session-A order, then B's extras). */
export const SL_LIFTS: readonly SlLiftId[] = [
  'squat',
  'bench',
  'row',
  'press',
  'deadlift',
] as const;

/** Reject a session number that is not a whole 1..12. */
function assertSlSession(n: number): void {
  if (!Number.isInteger(n) || n < 1 || n > SL_SESSIONS_PER_CYCLE) {
    throw new Error(`sl: session ${n} out of range (1..${SL_SESSIONS_PER_CYCLE})`);
  }
}

/** Session 1 is A and the slots alternate: odd → A, even → B. */
export function slSlotForSession(n: number): SlSlot {
  assertSlSession(n);
  return n % 2 === 1 ? 'A' : 'B';
}

/** Sessions 1–3 are week 1, 4–6 week 2, 7–9 week 3, 10–12 week 4. */
export function slWeekForSession(n: number): WeekNumber {
  assertSlSession(n);
  return Math.ceil(n / SL_SESSIONS_PER_WEEK) as WeekNumber;
}

/** Straight sets per lift: 5×5 for everything, 1×5 for the deadlift. */
export function slSetCount(liftId: SlLiftId): number {
  return liftId === 'deadlift' ? 1 : 5;
}

/** Default per-lift working-weight increment: deadlift double, everything else single. */
export function defaultSlIncrements(units: Units): Record<SlLiftId, number> {
  const small = units === 'lb' ? 5 : 2.5;
  const large = units === 'lb' ? 10 : 5;
  return { squat: small, bench: small, row: small, press: small, deadlift: large };
}

// ---------------------------------------------------------------------------
// Set + workout generation
// ---------------------------------------------------------------------------

/**
 * The straight work sets for one lift in one session, at an already-rounded
 * working weight. StrongLifts sets are ordinary {@link MainSet}s: kind 'work',
 * index 0..n-1, `percent` 1 (the weight IS the prescription — no TM percentage),
 * `targetReps` 5, never AMRAP. There are no warmups in the model.
 */
export function buildSlMainSets(weight: number, liftId: SlLiftId): MainSet[] {
  const count = slSetCount(liftId);
  const sets: MainSet[] = [];
  for (let i = 0; i < count; i++) {
    sets.push({
      kind: 'work',
      index: i,
      percent: 1,
      weight,
      targetReps: 5,
      amrap: false,
    });
  }
  return sets;
}

export interface BuildSlCycleWorkoutsArgs {
  cycleId: string;
  cycleNumber: number;
  units: Units;
  /**
   * Deterministic id source, exactly as {@link buildCycleWorkouts}: either a
   * generator called once per workout, or a pre-made list of ids in generation
   * order (36 of them). Providing ids keeps the function pure and testable.
   */
  ids: (() => string) | readonly string[];
}

/**
 * Build every workout of a StrongLifts block as `pending`: 12 sessions × 3
 * lifts = 36 rows, in session order with squat first within each session.
 *
 * Weights are LAZY. Unlike 5/3/1 — where the whole cycle's weights are frozen
 * at generation — a StrongLifts weight depends on how the preceding sessions
 * went, so rows are built with `mainSets: []` and `tmUsed: 0` and are stamped
 * when the session is started.
 */
export function buildSlCycleWorkouts(args: BuildSlCycleWorkoutsArgs): Workout[] {
  const { cycleId, cycleNumber, units, ids } = args;

  let cursor = 0;
  const nextId = (): string => {
    if (typeof ids === 'function') return ids();
    const id = ids[cursor];
    if (id === undefined) {
      throw new Error(`buildSlCycleWorkouts: not enough ids provided (needed index ${cursor})`);
    }
    cursor += 1;
    return id;
  };

  const workouts: Workout[] = [];
  for (let session = 1; session <= SL_SESSIONS_PER_CYCLE; session++) {
    const slSlot = slSlotForSession(session);
    const week = slWeekForSession(session);
    for (const liftId of SL_SLOT_LIFTS[slSlot]) {
      workouts.push({
        id: nextId(),
        cycleId,
        cycleNumber,
        week,
        liftId,
        status: 'pending',
        tmUsed: 0, // stamped with the working weight when the session starts
        mainSets: [], // lazy — see above
        accessoryWork: [], // StrongLifts blocks have no accessory work
        units,
        program: 'sl5x5',
        session,
        slSlot,
      });
    }
  }

  return workouts;
}

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

/**
 * Did this lift PASS its session? Every work set must have been logged at or
 * above its target reps. An UNLOGGED set counts as a miss (the finish
 * confirmation warns about exactly this), and a row with no work sets at all
 * — an unstamped row — can never pass.
 */
export function evaluateSlLiftPass(sets: readonly MainSet[]): boolean {
  const work = sets.filter((s) => s.kind === 'work');
  if (work.length === 0) return false;
  return work.every((s) => s.actualReps !== undefined && s.actualReps >= s.targetReps);
}

/** Fraction of the working weight kept when a lift deloads. */
export const SL_DELOAD_FACTOR = 0.9;

/** Consecutive misses that trigger a deload (the 3rd one). */
export const SL_FAILS_BEFORE_DELOAD = 3;

/**
 * Advance one lift's runtime after a session:
 *  - pass → add the increment, clear the streak.
 *  - miss, streak < 2 → repeat the same weight, streak + 1.
 *  - miss, streak === 2 (i.e. the 3rd consecutive miss) → deload to 90% of the
 *    working weight, rounded to `roundingIncrement`, and clear the streak.
 *
 * Pure: returns a NEW runtime, never mutates `state`.
 */
export function slProgressionStep(
  state: SlLiftRuntime,
  passed: boolean,
  roundingIncrement: number,
): SlLiftRuntime {
  if (passed) {
    return { ...state, weight: state.weight + state.increment, failStreak: 0 };
  }
  if (state.failStreak < SL_FAILS_BEFORE_DELOAD - 1) {
    return { ...state, failStreak: state.failStreak + 1 };
  }
  return {
    ...state,
    weight: roundToIncrement(state.weight * SL_DELOAD_FACTOR, roundingIncrement),
    failStreak: 0,
  };
}

/**
 * The weight a lift is PROJECTED to use `occurrencesBefore` sessions from now,
 * assuming every intervening session passes. Used to preview weights on
 * not-yet-stamped sessions (labelled "projected", never presented as frozen).
 */
export function projectSlWeight(state: SlLiftRuntime, occurrencesBefore: number): number {
  return state.weight + occurrencesBefore * state.increment;
}

// ---------------------------------------------------------------------------
// Switching in / out
// ---------------------------------------------------------------------------

/** Fraction of the 5/3/1 TM suggested as the opening StrongLifts working weight. */
export const SL_SWITCH_IN_TM_FRACTION = 0.85;

/**
 * Suggested opening working weights when switching INTO StrongLifts: 85% of
 * each 5/3/1 training max, rounded. Every value is editable in the setup screen
 * — this is a starting point, not a prescription. The row is not covered here:
 * it has no TM to derive from and is entered fresh (or carried from a prior
 * block).
 */
export function slSwitchInSuggestions(
  tms: Record<LiftId, number>,
  roundingIncrement: number,
): Record<LiftId, number> {
  const suggest = (tm: number): number =>
    roundToIncrement(SL_SWITCH_IN_TM_FRACTION * tm, roundingIncrement);
  return {
    press: suggest(tms.press),
    deadlift: suggest(tms.deadlift),
    bench: suggest(tms.bench),
    squat: suggest(tms.squat),
  };
}

/** A single logged effort (already normalised into one unit by the caller). */
export interface SlLiftEffort {
  weight: number;
  reps: number;
}

/**
 * Best e1RM across a lift's StrongLifts efforts, or null when none of them
 * yields a valid estimate. Pure — the caller extracts the efforts (via
 * `effortSet`) and normalises their units first.
 */
export function bestSlE1rm(efforts: readonly SlLiftEffort[]): number | null {
  let best: number | null = null;
  for (const e of efforts) {
    const e1 = epley(e.weight, e.reps);
    if (e1 !== null && (best === null || e1 > best)) best = e1;
  }
  return best;
}

/** Fraction of the best StrongLifts e1RM suggested as the returning TM. */
export const SL_RETURN_TM_FRACTION = 0.9;

/** Where a returning TM suggestion came from — surfaced verbatim to the user. */
export type SlReturnTmBasis = 'sl-e1rm' | 'current-tm';

export interface SlReturnTmSuggestion {
  liftId: LiftId;
  /** The TM the lift had when the block started (still authoritative). */
  currentTm: number;
  /** Best e1RM seen for this lift during the block; null = no usable efforts. */
  bestE1rm: number | null;
  /** The TM that e1RM alone would justify (90%, rounded); null when bestE1rm is. */
  e1rmDerivedTm: number | null;
  /** What to actually adopt: never below the current TM. */
  suggestedTm: number;
  basis: SlReturnTmBasis;
}

/**
 * Suggested training maxes when returning to 5/3/1 from a StrongLifts block:
 * `max(currentTm, round(0.9 × bestSlE1rm))` per main lift. A block that did not
 * out-perform the old TM leaves it untouched — the suggestion NEVER lowers a
 * TM, and `basis` says honestly which of the two won. The row has no TM and so
 * never appears here. Entries come back in {@link DAY_ORDER}.
 */
export function slReturnTmSuggestions(
  currentTms: Record<LiftId, number>,
  bestE1rms: Record<LiftId, number | null>,
  roundingIncrement: number,
): SlReturnTmSuggestion[] {
  return DAY_ORDER.map((liftId): SlReturnTmSuggestion => {
    const currentTm = currentTms[liftId];
    const best = bestE1rms[liftId];
    const e1rmDerivedTm =
      best === null ? null : roundToIncrement(SL_RETURN_TM_FRACTION * best, roundingIncrement);

    const raised = e1rmDerivedTm !== null && e1rmDerivedTm > currentTm;
    return {
      liftId,
      currentTm,
      bestE1rm: best,
      e1rmDerivedTm,
      suggestedTm: raised ? e1rmDerivedTm : currentTm,
      basis: raised ? 'sl-e1rm' : 'current-tm',
    };
  });
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

/** Build the full 5-lift runtime map for a new block from per-lift weights. */
export function buildSlCycleState(
  weights: Record<SlLiftId, number>,
  increments: Record<SlLiftId, number>,
  keepPrs: boolean,
): SlCycleState {
  const lifts = {} as Record<SlLiftId, SlLiftRuntime>;
  for (const liftId of SL_LIFTS) {
    lifts[liftId] = { weight: weights[liftId], increment: increments[liftId], failStreak: 0 };
  }
  return { lifts, keepPrs };
}
