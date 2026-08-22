import type {
  Cycle,
  SlCycleState,
  SlLiftId,
  SlLiftRuntime,
  SlSlot,
  Units,
  Workout,
} from '../../core/types.ts';
import {
  SL_FAILS_BEFORE_DELOAD,
  SL_SESSIONS_PER_CYCLE,
  SL_SLOT_LIFTS,
  buildSlMainSets,
  evaluateSlLiftPass,
  slProgressionStep,
  slSlotForSession,
} from '../../core/sl.ts';
import { db } from '../db.ts';
import { requireSettings } from './settingsRepo.ts';
import { logMainSet } from './workoutRepo.ts';

// ---------------------------------------------------------------------------
// Shared reads / invariants
// ---------------------------------------------------------------------------

/**
 * The ACTIVE cycle, required to be the StrongLifts block `cycleId` names.
 * Returns the runtime separately so callers get a non-optional
 * {@link SlCycleState} without a cast.
 */
async function requireActiveSlCycle(cycleId: string): Promise<{ cycle: Cycle; sl: SlCycleState }> {
  const active = await db.cycles.where('status').equals('active').first();
  if (!active) throw new Error('No active cycle.');
  if (active.id !== cycleId) {
    throw new Error(`Cycle ${cycleId} is not the active cycle.`);
  }
  const sl = active.sl;
  if (active.program !== 'sl5x5' || sl === undefined) {
    throw new Error(`Cycle ${cycleId} is not a StrongLifts block.`);
  }
  return { cycle: active, sl };
}

/** A workout is RESOLVED once it can no longer be trained: completed or skipped. */
function isResolved(w: Workout): boolean {
  return w.status === 'completed' || w.status === 'skipped';
}

/**
 * The earliest session of a StrongLifts block whose three rows are not ALL
 * resolved — i.e. the only session the user may act on. `null` once every
 * session is resolved (the block is ready to be completed).
 *
 * This is the SEQUENTIAL GATE: StrongLifts weights are lazy, so a later
 * session's load is unknowable until the ones before it have been settled.
 * Later sessions are view-only (projected weights).
 */
export function earliestUnresolvedSlSession(workouts: readonly Workout[]): number | null {
  for (let session = 1; session <= SL_SESSIONS_PER_CYCLE; session++) {
    const rows = workouts.filter((w) => w.session === session);
    if (rows.length === 0) continue;
    if (!rows.every(isResolved)) return session;
  }
  return null;
}

/**
 * The three rows of one session, in the order the lifts are performed
 * ({@link SL_SLOT_LIFTS}, squat first). Throws on a session that does not carry
 * exactly its slot's lifts, which can only mean corrupt data.
 */
function orderedSessionRows(all: readonly Workout[], session: number): Workout[] {
  const slot = slSlotForSession(session); // also validates 1..12
  const expected = SL_SLOT_LIFTS[slot];
  const inSession = all.filter((w) => w.session === session);
  if (inSession.length !== expected.length) {
    throw new Error(
      `StrongLifts session ${session} has ${inSession.length} rows, expected ${expected.length}.`,
    );
  }
  return expected.map((liftId) => {
    const row = inSession.find((w) => w.liftId === liftId);
    if (!row) throw new Error(`StrongLifts session ${session} is missing its ${liftId} row.`);
    return row;
  });
}

/** One lift's runtime, with a defensive check against a corrupt imported block. */
function runtimeFor(sl: SlCycleState, liftId: SlLiftId): SlLiftRuntime {
  const runtime: SlLiftRuntime | undefined = sl.lifts[liftId];
  if (!runtime) throw new Error(`StrongLifts block has no runtime for '${liftId}'.`);
  return runtime;
}

/** Enforce the sequential gate for an action on `session`. */
function assertIsCurrentSession(all: readonly Workout[], session: number): void {
  const earliest = earliestUnresolvedSlSession(all);
  if (earliest === null) {
    throw new Error('This StrongLifts block is finished — every session is resolved.');
  }
  if (earliest !== session) {
    throw new Error(`Session ${session} is not next: finish or skip session ${earliest} first.`);
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Start a StrongLifts session — the LAZY STAMP — in ONE transaction over
 * `cycles` + `workouts`:
 *  - the cycle must be the ACTIVE StrongLifts block,
 *  - `session` must pass the sequential gate (be the earliest unresolved one),
 *  - all three rows must still be pending,
 *  - and then all three are stamped ATOMICALLY: `mainSets` from the block's
 *    current working weight for that lift, `tmUsed` = that same weight (an SL
 *    row's "tmUsed" IS its working weight), status `in_progress`, `startedAt`.
 *
 * Re-calling on an already-started session is a NO-OP (resume): the stamped
 * weights are frozen and must never be re-derived from a runtime that a finish
 * may since have moved. Any other row state throws.
 *
 * Returns the three rows in performance order (squat first).
 */
export async function startSlSession(cycleId: string, session: number): Promise<Workout[]> {
  return db.transaction('rw', db.cycles, db.workouts, async () => {
    const { cycle, sl } = await requireActiveSlCycle(cycleId);
    const all = await db.workouts.where('cycleId').equals(cycle.id).toArray();
    const rows = orderedSessionRows(all, session);

    assertIsCurrentSession(all, session);

    if (rows.every((w) => w.status === 'in_progress')) return rows; // resume
    if (!rows.every((w) => w.status === 'pending')) {
      throw new Error(
        `Cannot start session ${session}: its rows are ${rows.map((w) => w.status).join(', ')}.`,
      );
    }

    const now = new Date().toISOString();
    const stamped = rows.map((w): Workout => {
      const weight = runtimeFor(sl, w.liftId).weight;
      return {
        ...w,
        status: 'in_progress',
        startedAt: now,
        tmUsed: weight,
        mainSets: buildSlMainSets(weight, w.liftId),
        // UNITS COME FROM THE CYCLE, not from the row. The weight above is read
        // from `sl.lifts`, which `switchUnits` converts in place; a pending row
        // built before that switch still carries the OLD units label. Spreading
        // `...w` would therefore freeze converted kilos under the word 'lb' —
        // permanently, since a completed row is history. The two must be stamped
        // from the same source, and the cycle is that source.
        units: cycle.units,
        accessoryWork: [], // StrongLifts blocks never carry accessory work
      };
    });
    await db.workouts.bulkPut(stamped);
    return stamped;
  });
}

/** What one lift's progression did at the end of a session — the UI's copy source. */
export interface SlLiftOutcome {
  liftId: SlLiftId;
  /** Every work set logged at or above its target reps (an unlogged set is a miss). */
  passed: boolean;
  /** The lift's runtime BEFORE this session's progression ran. */
  before: SlLiftRuntime;
  /** The lift's runtime AFTER it — what the next session will use. */
  after: SlLiftRuntime;
  /** True when this was the third consecutive miss, i.e. `after.weight` is a deload. */
  deloaded: boolean;
}

/**
 * Finish a StrongLifts session in ONE transaction over `settings` + `cycles` +
 * `workouts`. All three rows must be `in_progress`; each lift is evaluated
 * ({@link evaluateSlLiftPass}) and advanced ({@link slProgressionStep}, rounded
 * with Settings.roundingIncrement read INSIDE the transaction), the block's
 * runtime and the three completed rows are written together, and the per-lift
 * outcomes come back for the confirmation copy.
 *
 * Progression runs ONLY on the in_progress → completed transition, so a
 * double-finish throws and a weight can never be advanced twice.
 */
export async function finishSlSession(cycleId: string, session: number): Promise<SlLiftOutcome[]> {
  return db.transaction('rw', db.settings, db.cycles, db.workouts, async () => {
    const { cycle, sl } = await requireActiveSlCycle(cycleId);
    const settings = await requireSettings();
    const all = await db.workouts.where('cycleId').equals(cycle.id).toArray();
    const rows = orderedSessionRows(all, session);

    if (!rows.every((w) => w.status === 'in_progress')) {
      throw new Error(
        `Cannot finish session ${session}: its rows are ${rows
          .map((w) => w.status)
          .join(', ')}, expected in_progress.`,
      );
    }

    const now = new Date().toISOString();
    const lifts: Record<SlLiftId, SlLiftRuntime> = { ...sl.lifts };
    const outcomes: SlLiftOutcome[] = [];

    for (const w of rows) {
      const before = runtimeFor(sl, w.liftId);
      const passed = evaluateSlLiftPass(w.mainSets);
      const after = slProgressionStep(before, passed, settings.roundingIncrement);
      lifts[w.liftId] = after;
      outcomes.push({
        liftId: w.liftId,
        passed,
        before,
        after,
        deloaded: !passed && before.failStreak >= SL_FAILS_BEFORE_DELOAD - 1,
      });
    }

    await db.cycles.put({ ...cycle, sl: { ...sl, lifts } });
    await db.workouts.bulkPut(
      rows.map((w): Workout => ({ ...w, status: 'completed', completedAt: now })),
    );

    return outcomes;
  });
}

/**
 * Skip a whole StrongLifts session (all three rows) in ONE transaction. The
 * block's runtime is UNTOUCHED — a skipped session neither progresses a lift
 * nor counts as a miss. Honors the same sequential gate as
 * {@link startSlSession}; re-skipping is a no-op and a completed session throws.
 */
export async function skipSlSession(cycleId: string, session: number): Promise<void> {
  await db.transaction('rw', db.cycles, db.workouts, async () => {
    const { cycle } = await requireActiveSlCycle(cycleId);
    const all = await db.workouts.where('cycleId').equals(cycle.id).toArray();
    const rows = orderedSessionRows(all, session);

    if (rows.every((w) => w.status === 'skipped')) return;
    if (rows.some((w) => w.status === 'completed')) {
      throw new Error(`Cannot skip session ${session}: it is already completed.`);
    }
    assertIsCurrentSession(all, session);

    await db.workouts.bulkPut(rows.map((w): Workout => ({ ...w, status: 'skipped' })));
  });
}

/**
 * Un-skip a StrongLifts session in ONE transaction, allowed ONLY while every
 * LATER session is still pending — once a later session has been stamped its
 * weights came from a ladder this session would now re-enter, and history must
 * not be re-based.
 *
 * The three rows go back to a FRESH pending shape: `mainSets` emptied, `tmUsed`
 * 0, `startedAt`/`completedAt`/`editedAt` removed. Any reps entered before the
 * skip are discarded (the confirm copy says so) and the session re-stamps at the
 * block's current weights on the next start. Notes survive.
 */
export async function unskipSlSession(cycleId: string, session: number): Promise<void> {
  await db.transaction('rw', db.cycles, db.workouts, async () => {
    const { cycle } = await requireActiveSlCycle(cycleId);
    const all = await db.workouts.where('cycleId').equals(cycle.id).toArray();
    const rows = orderedSessionRows(all, session);

    if (!rows.every((w) => w.status === 'skipped')) {
      throw new Error(
        `Cannot unskip session ${session}: its rows are ${rows.map((w) => w.status).join(', ')}.`,
      );
    }
    const later = all.filter((w) => w.session !== undefined && w.session > session);
    if (!later.every((w) => w.status === 'pending')) {
      throw new Error(
        `Cannot unskip session ${session}: a later session has already been started, skipped or completed.`,
      );
    }

    const slot = slSlotForSession(session);
    await db.workouts.bulkPut(
      rows.map((w) => freshPendingSlRow(w, session, slot, cycle.units)),
    );
  });
}

/**
 * Rebuild an SL row in the exact shape `buildSlCycleWorkouts` produces, so an
 * un-skipped session is indistinguishable from one that was never touched. Keys
 * are written explicitly (never `startedAt: undefined`), so no phantom key
 * survives into the stored record. `units` is the CYCLE's, not the old row's.
 */
function freshPendingSlRow(
  w: Workout,
  session: number,
  slSlot: SlSlot,
  units: Units,
): Workout {
  const row: Workout = {
    id: w.id,
    cycleId: w.cycleId,
    cycleNumber: w.cycleNumber,
    week: w.week,
    liftId: w.liftId,
    status: 'pending',
    tmUsed: 0,
    mainSets: [],
    accessoryWork: [],
    // Same rule as the stamp: units follow the CYCLE. An un-skip after a unit
    // switch must not resurrect the row's stale label, or the re-stamp would
    // write converted weights under it.
    units,
    program: 'sl5x5',
    session,
    slSlot,
  };
  if (w.notes !== undefined) row.notes = w.notes;
  return row;
}

/**
 * Log one StrongLifts work set. StrongLifts rows carry only `work` sets (index
 * 0..4; the deadlift has index 0 only), so the caller never names a kind.
 * Delegates to {@link logMainSet}, which carries the guard that a PENDING
 * StrongLifts row cannot be auto-started — the session starts as a unit or not
 * at all.
 */
export async function logSlSet(
  workoutId: string,
  index: number,
  actualReps: number,
): Promise<void> {
  await logMainSet(workoutId, 'work', index, actualReps);
}

/** Refusal copy when an override would collide with the session in flight. */
export const SL_OVERRIDE_IN_FLIGHT_ERROR =
  'Finish the session in flight first — the override applies from the next session.';

/**
 * Whether overriding `liftId` right now would collide with the session in
 * flight: the earliest unresolved session has already been STAMPED (its rows
 * are in_progress) AND it trains this lift.
 *
 * The reason this is a refusal rather than a silent no-op is progression.
 * `finishSlSession` advances each lift from the block's LIVE runtime, not from
 * the weight frozen on the row — so an override applied mid-session is not
 * ignored, it is compounded: a pass writes override + increment, and a third
 * miss deloads to 90% of a weight that was never actually lifted. Blocking the
 * write is what makes the modal's promise ("applies from the next session") true.
 *
 * Exported so the modal can DISABLE the control and say why, instead of letting
 * the user commit and then explaining the rejection.
 */
export function slOverrideBlockedByInFlight(
  workouts: readonly Workout[],
  liftId: SlLiftId,
): boolean {
  const session = earliestUnresolvedSlSession(workouts);
  if (session === null) return false;
  const rows = workouts.filter((w) => w.session === session);
  if (!rows.some((w) => w.status === 'in_progress')) return false;
  return rows.some((w) => w.liftId === liftId);
}

/**
 * Override the working weight one lift will use from its NEXT session onward,
 * in ONE transaction over `cycles` + `workouts`.
 *
 * Scope is deliberately narrow — this is the cycle screen's weight chip, the
 * StrongLifts analogue of a TM override:
 *  - only `sl.lifts[liftId].weight` changes. The `increment` and, critically,
 *    the `failStreak` are PRESERVED: a manual correction is not an assertion
 *    that the misses never happened, and silently clearing the streak would
 *    postpone a deload the lift has already earned.
 *  - NO workout row is written. `workouts` is in the transaction scope to be
 *    READ, for the in-flight guard below. Already-stamped rows are frozen
 *    (history) and every later session is unstamped, so future sessions pick the
 *    new weight up on their next start: "future sessions only" is structural.
 *  - a lift trained by the session CURRENTLY IN FLIGHT is refused outright
 *    ({@link slOverrideBlockedByInFlight}), because that session's finish would
 *    otherwise progress ON TOP of the new weight. A lift the in-flight session
 *    does not train — the press while an A-session is open — is unaffected.
 */
export async function overrideSlLiftWeight(
  cycleId: string,
  liftId: SlLiftId,
  weight: number,
): Promise<void> {
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error('A StrongLifts working weight must be greater than zero.');
  }
  await db.transaction('rw', db.cycles, db.workouts, async () => {
    const { cycle, sl } = await requireActiveSlCycle(cycleId);
    const current = runtimeFor(sl, liftId);
    const all = await db.workouts.where('cycleId').equals(cycle.id).toArray();
    if (slOverrideBlockedByInFlight(all, liftId)) {
      throw new Error(SL_OVERRIDE_IN_FLIGHT_ERROR);
    }
    await db.cycles.put({
      ...cycle,
      sl: { ...sl, lifts: { ...sl.lifts, [liftId]: { ...current, weight } } },
    });
  });
}
