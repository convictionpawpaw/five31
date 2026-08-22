import type {
  Cycle,
  MainSet,
  SlCycleState,
  SlLiftId,
  SlLiftRuntime,
  SlSlot,
  Units,
  WeekNumber,
  Workout,
} from '../../core/types.ts';
import {
  SL_FAILS_BEFORE_DELOAD,
  SL_LIFTS,
  SL_SESSIONS_PER_CYCLE,
  SL_SLOT_LIFTS,
  buildSlMainSets,
  evaluateSlLiftPass,
  projectSlWeight,
  slProgressionStep,
  slSetCount,
  slSlotForSession,
  slWeekForSession,
} from '../../core/sl.ts';
import { effortSet } from '../../core/efforts.ts';
import { epley } from '../../core/e1rm.ts';
import { convertWeight } from '../../core/units.ts';
import { roundToIncrement } from '../../core/rounding.ts';
import { fmtWeight } from '../shared/format.ts';

/**
 * React-free view model for StrongLifts blocks. Everything the session screen,
 * Today's hero, the cycle grid and the complete-cycle modal need to DERIVE from
 * a block's rows + runtime lives here, so it can be unit-tested without a DOM.
 *
 * The sequential gate itself (which session may be acted on) belongs to the
 * repo — `earliestUnresolvedSlSession` — and is passed IN as `currentSession`
 * rather than re-implemented, so there is exactly one definition of "current".
 */

// ---------------------------------------------------------------------------
// Rows + status
// ---------------------------------------------------------------------------

/** A StrongLifts row is RESOLVED once it can no longer be trained. */
export function isSlRowResolved(w: Workout): boolean {
  return w.status === 'completed' || w.status === 'skipped';
}

/**
 * The rows of one session in PERFORMANCE order (squat first). Unlike the repo's
 * strict variant this never throws: a malformed session simply yields the rows
 * it does have, so a corrupt block renders instead of crashing the screen.
 */
export function slSessionRows(workouts: readonly Workout[], session: number): Workout[] {
  const slot = slSlotForSession(session);
  const inSession = workouts.filter((w) => w.session === session);
  const out: Workout[] = [];
  for (const liftId of SL_SLOT_LIFTS[slot]) {
    const row = inSession.find((w) => w.liftId === liftId);
    if (row) out.push(row);
  }
  return out;
}

/** Aggregate status of a session: uniform when its rows agree, else 'mixed'. */
export type SlSessionStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'mixed';

/**
 * The session-level status glyph. Sessions transition as a UNIT, so in practice
 * the three rows always agree; 'mixed' exists so imported/corrupt data still
 * renders something honest rather than claiming a state it isn't in.
 */
export function slSessionStatus(rows: readonly Workout[]): SlSessionStatus {
  if (rows.length === 0) return 'pending';
  const first = rows[0]!.status;
  return rows.every((w) => w.status === first) ? first : 'mixed';
}

/**
 * How many more times `liftId` is scheduled to progress BEFORE `session`: the
 * count of UNRESOLVED earlier sessions that train it. Resolved earlier sessions
 * are excluded because their effect is already folded into the block runtime's
 * current weight.
 */
export function slOccurrencesBefore(
  workouts: readonly Workout[],
  session: number,
  liftId: SlLiftId,
): number {
  let n = 0;
  for (const w of workouts) {
    if (w.session === undefined || w.session >= session) continue;
    if (w.liftId !== liftId) continue;
    if (!isSlRowResolved(w)) n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Session view model
// ---------------------------------------------------------------------------

/**
 * Where a displayed weight came from:
 *  - 'stamped'   frozen on the row when its session started. Authoritative.
 *  - 'current'   the block's live working weight, exact but not yet frozen —
 *                the next session to be trained, and the only unstamped case
 *                that is NOT a forecast.
 *  - 'projected' a forecast: it assumes every unresolved session before this
 *                one is passed. Must always be labelled as such in the UI.
 *  - 'none'      there IS no weight: the row is resolved (skipped) but was
 *                never stamped, so it has no history to show and no future to
 *                forecast. `weight` is null and the UI renders a placeholder.
 */
export type SlWeightBasis = 'stamped' | 'current' | 'projected' | 'none';

/** One lift within a session, ready to render. */
export interface SlLiftView {
  liftId: SlLiftId;
  workout: Workout;
  /** The weight to show, or null when `basis` is 'none' — never a stand-in. */
  weight: number | null;
  basis: SlWeightBasis;
  /** The work sets to render — the row's own when stamped, else a preview. */
  sets: MainSet[];
  /** Work sets with a logged rep count. */
  loggedCount: number;
  /** Every work set logged (the gate for showing the progression preview). */
  allLogged: boolean;
}

/** A whole session, ready to render. */
export interface SlSessionView {
  session: number;
  slot: SlSlot;
  week: WeekNumber;
  lifts: SlLiftView[];
  status: SlSessionStatus;
}

/** The work sets of a row (StrongLifts rows carry no warmups, but be explicit). */
function workSetsOf(w: Workout): MainSet[] {
  return w.mainSets.filter((s) => s.kind === 'work');
}

/**
 * Build a renderable view of one session. A row that has been STAMPED shows its
 * frozen weight and its real sets; an unstamped row shows
 * `state.weight + unresolvedEarlierOccurrences × increment` and a set PREVIEW
 * built at that weight, so the chip layout is identical either way and the
 * caller only has to gate interaction on `basis`/mode.
 */
export function buildSlSessionView(
  workouts: readonly Workout[],
  session: number,
  sl: SlCycleState | undefined,
): SlSessionView {
  const slot = slSlotForSession(session);
  const rows = slSessionRows(workouts, session);

  const lifts = rows.map((workout): SlLiftView => {
    const stamped = workout.mainSets.length > 0;
    if (stamped) {
      const sets = workSetsOf(workout);
      const loggedCount = sets.filter((s) => s.actualReps !== undefined).length;
      return {
        liftId: workout.liftId,
        workout,
        weight: sets[0]?.weight ?? workout.tmUsed,
        basis: 'stamped',
        sets,
        loggedCount,
        allLogged: sets.length > 0 && loggedCount === sets.length,
      };
    }
    // RESOLVED BUT NEVER STAMPED — a session skipped before it was started.
    // It has no frozen weight, and the live/projected one would be a lie that
    // silently REWRITES itself every time a later session moves the runtime:
    // a settled piece of history tracking today's working weight. Show nothing.
    if (isSlRowResolved(workout)) {
      return {
        liftId: workout.liftId,
        workout,
        weight: null,
        basis: 'none',
        sets: [],
        loggedCount: 0,
        allLogged: false,
      };
    }
    const runtime = sl?.lifts[workout.liftId];
    const before = slOccurrencesBefore(workouts, session, workout.liftId);
    const weight = runtime ? projectSlWeight(runtime, before) : 0;
    return {
      liftId: workout.liftId,
      workout,
      weight,
      // Zero unresolved earlier occurrences means no forecasting happened: the
      // weight IS the block's current one, and calling it 'projected' would be
      // a lie the user would (rightly) stop trusting.
      basis: before > 0 ? 'projected' : 'current',
      sets: buildSlMainSets(weight, workout.liftId),
      loggedCount: 0,
      allLogged: false,
    };
  });

  return { session, slot, week: slWeekForSession(session), lifts, status: slSessionStatus(rows) };
}

/**
 * What the user may DO with a session:
 *  - 'resolved'  — completed or skipped: read-only (un-skip may still apply).
 *  - 'log'       — it is the current (earliest unresolved) session.
 *  - 'projected' — a later session: view-only, weights are forecasts.
 *
 * `currentSession` is `earliestUnresolvedSlSession(workouts)`; null means every
 * session is resolved and the block is ready to be completed.
 */
export type SlSessionMode = 'log' | 'projected' | 'resolved';

export function slSessionMode(
  session: number,
  currentSession: number | null,
  rows: readonly Workout[],
): SlSessionMode {
  if (rows.length > 0 && rows.every(isSlRowResolved)) return 'resolved';
  return session === currentSession ? 'log' : 'projected';
}

/**
 * Whether the session's un-skip is allowed: it is fully skipped AND every later
 * session is still pending. Mirrors `unskipSlSession`'s guard so the button is
 * hidden rather than offered and then rejected.
 */
export function canUnskipSlSession(workouts: readonly Workout[], session: number): boolean {
  const rows = slSessionRows(workouts, session);
  if (rows.length === 0 || !rows.every((w) => w.status === 'skipped')) return false;
  return workouts
    .filter((w) => w.session !== undefined && w.session > session)
    .every((w) => w.status === 'pending');
}

/** Unlogged work sets across a session's rows — the finish-confirmation gate. */
export function countUnloggedSlSets(rows: readonly Workout[]): number {
  let n = 0;
  for (const w of rows) {
    for (const s of w.mainSets) {
      if (s.kind === 'work' && s.actualReps === undefined) n += 1;
    }
    // An unstamped row has no sets at all; every one of them would be a miss.
    if (w.mainSets.length === 0) n += slSetCount(w.liftId);
  }
  return n;
}

/** The most recent session whose three rows are all completed, or null. */
export function lastCompletedSlSession(workouts: readonly Workout[]): number | null {
  for (let session = SL_SESSIONS_PER_CYCLE; session >= 1; session--) {
    const rows = slSessionRows(workouts, session);
    if (rows.length > 0 && rows.every((w) => w.status === 'completed')) return session;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Progression preview + copy
// ---------------------------------------------------------------------------

/**
 * The shape `finishSlSession` returns (`SlLiftOutcome`) and the shape the live
 * preview produces. Declared structurally here so the copy helper serves both
 * without the feature layer importing the repo.
 */
export interface SlOutcomeLike {
  liftId: SlLiftId;
  passed: boolean;
  before: SlLiftRuntime;
  after: SlLiftRuntime;
  deloaded: boolean;
}

/**
 * The outcome the FINISH would write for one lift, computed live from the sets
 * as they stand. Deliberately the same two core calls `finishSlSession` makes
 * (`evaluateSlLiftPass` then `slProgressionStep`), so the preview and the write
 * can never disagree.
 */
export function previewSlLiftOutcome(
  liftId: SlLiftId,
  before: SlLiftRuntime,
  sets: readonly MainSet[],
  roundingIncrement: number,
): SlOutcomeLike {
  const passed = evaluateSlLiftPass(sets);
  const after = slProgressionStep(before, passed, roundingIncrement);
  return {
    liftId,
    passed,
    before,
    after,
    deloaded: !passed && before.failStreak >= SL_FAILS_BEFORE_DELOAD - 1,
  };
}

/**
 * The one-line verdict shown under a lift, in all three flavours:
 *  - pass     → '230 next session (+5)'
 *  - miss     → 'Repeat 185 next session (miss 1 of 3)'
 *  - deload   → 'Deload: 185 → 165 next session (−10%)'
 * Unit-free by design: the weight's unit is already on the section header.
 */
export function slOutcomeCopy(o: SlOutcomeLike): string {
  if (o.deloaded) {
    return `Deload: ${fmtWeight(o.before.weight)} → ${fmtWeight(o.after.weight)} next session (−10%)`;
  }
  if (o.passed) {
    return `${fmtWeight(o.after.weight)} next session (+${fmtWeight(o.after.increment)})`;
  }
  return `Repeat ${fmtWeight(o.after.weight)} next session (miss ${o.after.failStreak} of ${SL_FAILS_BEFORE_DELOAD})`;
}

/** Fail-streak pips for a lift chip: one slot per miss before a deload. */
export function slStreakPips(failStreak: number): boolean[] {
  const pips: boolean[] = [];
  for (let i = 0; i < SL_FAILS_BEFORE_DELOAD; i++) pips.push(i < failStreak);
  return pips;
}

// ---------------------------------------------------------------------------
// Switch-back inputs
// ---------------------------------------------------------------------------

/** The best single effort a lift produced during a block, in the target units. */
export interface SlBestEffort {
  weight: number;
  reps: number;
  e1rm: number;
}

/**
 * The best (highest-e1RM) StrongLifts effort per lift across `workouts`, in
 * `targetUnits`. Efforts come from `effortSet`, which on a StrongLifts row is
 * the logged work set with the highest e1RM — so this is a max over maxima.
 * Only COMPLETED StrongLifts rows count. Lifts with no usable effort are absent.
 */
export function bestSlEffortsByLift(
  workouts: readonly Workout[],
  targetUnits: Units,
): Partial<Record<SlLiftId, SlBestEffort>> {
  const out: Partial<Record<SlLiftId, SlBestEffort>> = {};
  for (const w of workouts) {
    if (w.program !== 'sl5x5' || w.status !== 'completed') continue;
    const set = effortSet(w);
    if (!set || set.actualReps === undefined) continue;
    const weight = convertWeight(set.weight, w.units, targetUnits);
    const e1rm = epley(weight, set.actualReps);
    if (e1rm === null) continue;
    const current = out[w.liftId];
    if (current === undefined || e1rm > current.e1rm) {
      out[w.liftId] = { weight, reps: set.actualReps, e1rm };
    }
  }
  return out;
}

/** A carried row weight, in the units of the block it came FROM. */
export interface CarriedSlRowWeight {
  weight: number;
  /** The units that weight is denominated in — the source block's own. */
  units: Units;
}

/**
 * The row's working weight carried from the most recent StrongLifts block, so a
 * user switching back in doesn't have to re-guess it. Null when the row has
 * never been trained (the setup screen then requires an explicit entry).
 *
 * The UNITS come back with it, and are load-bearing: a completed block's runtime
 * is frozen in the units that block ended in (`switchUnits` only converts the
 * ACTIVE cycle), so a bare number handed to a setup screen running in the other
 * unit is off by 2.2× in whichever direction hurts. Callers convert.
 */
export function latestSlRowWeight(cycles: readonly Cycle[]): CarriedSlRowWeight | null {
  let best: Cycle | null = null;
  for (const c of cycles) {
    if (c.program !== 'sl5x5' || c.sl === undefined) continue;
    if (best === null || c.number > best.number) best = c;
  }
  if (best?.sl === undefined) return null;
  return { weight: best.sl.lifts.row.weight, units: best.units };
}

/**
 * The carried row weight expressed in TODAY's units, rounded to the user's
 * rounding increment — what the switch-in setup screen prefills.
 *
 * The conversion is the whole point: a completed block's runtime is frozen in
 * the units that block ended in, so an lb block's 165 handed straight to a kg
 * setup screen prefills 165 KG — 2.2× the real weight, under a chip that says
 * the number can be trusted. Kg to lb runs the other way, at under half.
 */
export function carriedRowPrefill(
  carried: CarriedSlRowWeight,
  units: Units,
  roundingIncrement: number,
): number {
  return roundToIncrement(convertWeight(carried.weight, carried.units, units), roundingIncrement);
}

/**
 * The 'carried' chip's label. When the carried weight had to be CONVERTED to
 * reach the current units, the chip names the original denomination — the chip
 * is what makes the prefill look trustworthy, so it has to show its work:
 * 'carried · 165 LB' next to a 75 KG stepper is checkable, 'carried' is not.
 */
export function carriedRowChipLabel(
  carried: CarriedSlRowWeight,
  currentUnits: Units,
): string {
  if (carried.units === currentUnits) return 'carried';
  return `carried · ${fmtWeight(carried.weight)} ${carried.units.toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Switch-in setup validation
// ---------------------------------------------------------------------------

/** Inline copy under a switch-in weight that cannot start a block. */
export const SL_WEIGHT_REQUIRED_COPY = 'Set a starting weight above zero to continue.';

/** Inline copy under the Barbell Row when it has no carried weight to fall back on. */
export const SL_ROW_REQUIRED_COPY = 'Enter a starting weight for the Barbell Row to continue.';

/**
 * Which of the five switch-in weights block the confirm — anything not finite
 * and greater than zero. `completeCycleToSl` refuses these outright; this is the
 * same rule stated in the setup screen so it surfaces as copy under the offending
 * stepper rather than as a toast after the fact. Press-and-hold on a minus button
 * reaches zero on any of the five, not only the row.
 */
export function slSetupBlockingLifts(weights: Record<SlLiftId, number>): SlLiftId[] {
  return SL_LIFTS.filter((liftId) => {
    const w = weights[liftId];
    return !Number.isFinite(w) || w <= 0;
  });
}

// ---------------------------------------------------------------------------
// Program-switch copy
// ---------------------------------------------------------------------------

/**
 * Copy lives here, next to the maths it describes, for the same reason the grid
 * builder does: it is derived, it has to stay true when the numbers move, and a
 * string assembled in JSX cannot be tested.
 */

/** Why the four suggested opening weights are what they are. */
export const SL_SWITCH_IN_WEIGHT_COPY =
  '≈85% of your training max — the classic 5×5 grind zone. Edit freely.';

/** Why the row is blank (or carried) rather than derived. */
export const SL_ROW_START_COPY =
  'Barbell Row starts fresh — pick a weight you can row 5×5 with strict form; StrongLifts says start light.';

/**
 * Why the deadlift's default increment is double everything else's. Unit-aware:
 * the canon is stated in the units the user is actually lifting in, never a
 * pounds figure shown to someone training in kilos.
 */
export function slDeadliftIncrementCopy(units: Units): string {
  const big = units === 'lb' ? '10' : '5';
  const small = units === 'lb' ? '5' : '2.5';
  return `+${big} per session while it progresses easily — StrongLifts canon. Drop to +${small} when it slows.`;
}

/** Keep-PRs ON: one unbroken record book across both programs. */
export const KEEP_PRS_ON_COPY =
  'One record book. Your 5/3/1 records stand; a big 5×5 set can beat them.';

/** Keep-PRs OFF: a fresh slate, with the old badges preserved in History. */
export const KEEP_PRS_OFF_COPY =
  'Records restart at the switch. Old PR badges stay in History.';

/** The keep-PRs explainer for the toggle's CURRENT position. */
export function keepPrsCopy(on: boolean): string {
  return on ? KEEP_PRS_ON_COPY : KEEP_PRS_OFF_COPY;
}

/**
 * The honest one-line basis for a returning training-max suggestion:
 *  - raised by the block → '90% of your best 5×5 e1RM (205×5)', naming the very
 *    set that justified it, so the number can be argued with.
 *  - not raised → says so plainly rather than dressing a no-op as a decision.
 *
 * `best` is that lift's entry from {@link bestSlEffortsByLift}; when the basis
 * is 'sl-e1rm' it is always present, and the fallback keeps this total.
 */
export function slReturnBasisCopy(
  basis: 'sl-e1rm' | 'current-tm',
  best: SlBestEffort | undefined,
): string {
  if (basis === 'sl-e1rm' && best !== undefined) {
    return `90% of your best 5×5 e1RM (${fmtWeight(best.weight)}×${best.reps})`;
  }
  return "keeping your previous TM — your 5×5 block didn't exceed it";
}
