import { ulid } from 'ulid';
import type {
  Cycle,
  LiftId,
  SlCycleState,
  SlLiftId,
  SlLiftRuntime,
  Workout,
} from '../../core/types.ts';
import { DAY_ORDER, normalizeDayOrder } from '../../core/scheme.ts';
import {
  addDeloadPlan,
  buildCycleWorkouts,
  removeDeloadPlan,
  type CycleLiftInput,
} from '../../core/cycle.ts';
import { SL_LIFTS, buildSlCycleState, buildSlCycleWorkouts } from '../../core/sl.ts';
import { db } from '../db.ts';
import { requireSettings, settingsAfterProgramSwitch } from './settingsRepo.ts';

/** Refuse a classic-5/3/1 mutation that was pointed at a StrongLifts block. */
function assertNotSlCycle(cycle: Cycle, what: string): void {
  if (cycle.program === 'sl5x5') {
    throw new Error(`${what} is unavailable during a StrongLifts block.`);
  }
}

/** Require a cycle to BE a StrongLifts block; returns the runtime without a cast. */
function requireSlRuntime(cycle: Cycle): SlCycleState {
  const sl = cycle.sl;
  if (cycle.program !== 'sl5x5' || sl === undefined) {
    throw new Error('The active cycle is not a StrongLifts block.');
  }
  return sl;
}

/**
 * Copy a block's per-lift runtimes VERBATIM — weights AND fail streaks — into a
 * fresh record. Written key-by-key (rather than a spread over SL_LIFTS with a
 * cast) so the compiler proves all five lifts are present.
 */
function copySlLifts(lifts: Record<SlLiftId, SlLiftRuntime>): Record<SlLiftId, SlLiftRuntime> {
  return {
    squat: { ...lifts.squat },
    bench: { ...lifts.bench },
    row: { ...lifts.row },
    press: { ...lifts.press },
    deadlift: { ...lifts.deadlift },
  };
}

/** The audit note every TmEvent written by the switch BACK to 5/3/1 carries. */
export const SL_RETURN_TM_NOTE = 'return from 5×5';

/** The current active cycle, or undefined if none exists yet. */
export async function getActiveCycle(): Promise<Cycle | undefined> {
  return db.cycles.where('status').equals('active').first();
}

/** The active cycle or throw — most flows assume one exists. */
export async function requireActiveCycle(): Promise<Cycle> {
  const cycle = await getActiveCycle();
  if (!cycle) throw new Error('No active cycle.');
  return cycle;
}

/** All workouts for a cycle. */
export async function getCycleWorkouts(cycleId: string): Promise<Workout[]> {
  return db.workouts.where('cycleId').equals(cycleId).toArray();
}

/** Every cycle, ordered by number ascending (used by export/history). */
export async function listCycles(): Promise<Cycle[]> {
  const cycles = await db.cycles.toArray();
  return cycles.sort((a, b) => a.number - b.number);
}

/**
 * Complete the active cycle and open the next one, in ONE transaction:
 *  1. Mark the active cycle `completed` (stamp completedAt).
 *  2. Write one 'cycle_advance' TmEvent per lift (from current TM → finalTm),
 *     per the audit-log spirit — one event per lift regardless of whether the
 *     value changed.
 *  3. Update LiftState to the new (final) TMs.
 *  4. Create Cycle N+1 (status 'active', tms = finalTms, includeDeload from
 *     Settings, units from Settings) and build+insert its pending workouts.
 *
 * `finalTms` are the user-confirmed TMs (recommendation may have been overridden
 * in the Complete-Cycle modal). All-or-nothing.
 */
export async function completeCycle(finalTms: Record<LiftId, number>): Promise<Cycle> {
  return db.transaction(
    'rw',
    db.settings,
    db.cycles,
    db.liftState,
    db.tmEvents,
    db.workouts,
    async () => {
      const settings = await requireSettings();
      const active = await db.cycles.where('status').equals('active').first();
      if (!active) throw new Error('No active cycle to complete.');
      // GUARD: a StrongLifts block has no TM advance to compute — completing it
      // goes through completeSlCycleContinue / completeSlCycleReturn instead.
      assertNotSlCycle(active, 'Completing a 5/3/1 cycle');

      const now = new Date().toISOString();

      // 1. Close out the active cycle.
      await db.cycles.put({ ...active, status: 'completed', completedAt: now });

      // 2 + 3. Audit events + LiftState update, one per lift.
      for (const liftId of DAY_ORDER) {
        const fromValue = active.tms[liftId];
        const toValue = finalTms[liftId];
        await db.tmEvents.add({
          id: ulid(),
          liftId,
          cycleId: active.id,
          timestamp: now,
          type: 'cycle_advance',
          fromValue,
          toValue,
        });
        await db.liftState.put({ liftId, trainingMax: toValue });
      }

      // 4. Open the next cycle with the new TMs.
      const nextId = ulid();
      const nextCycle: Cycle = {
        id: nextId,
        number: active.number + 1,
        status: 'active',
        startedAt: now,
        tms: { ...finalTms },
        includeDeload: settings.includeDeload,
        units: settings.units,
      };
      await db.cycles.add(nextCycle);

      const lifts = liftInputs(finalTms, settings.roundingIncrement);
      const workouts = buildCycleWorkouts({
        cycleId: nextId,
        cycleNumber: nextCycle.number,
        includeDeload: settings.includeDeload,
        units: settings.units,
        lifts,
        ids: () => ulid(),
        dayOrder: normalizeDayOrder(settings.dayOrder),
      });
      await db.workouts.bulkAdd(workouts);

      return nextCycle;
    },
  );
}

/** Add a deload week to the active cycle (wraps core addDeloadPlan) in one transaction. */
export async function addDeloadToActiveCycle(): Promise<void> {
  await db.transaction('rw', db.settings, db.cycles, db.workouts, async () => {
    const settings = await requireSettings();
    const active = await db.cycles.where('status').equals('active').first();
    if (!active) throw new Error('No active cycle.');
    // GUARD (week-4 footgun): StrongLifts sessions 10–12 carry week === 4, so a
    // deload plan would treat them as a deload week — here, refusing to ADD one
    // on top of rows that already occupy week 4.
    assertNotSlCycle(active, 'Adding a deload week');

    const existing = await db.workouts.where('cycleId').equals(active.id).toArray();
    const lifts = liftInputs(active.tms, settings.roundingIncrement);
    const plan = addDeloadPlan(existing, {
      cycleId: active.id,
      cycleNumber: active.number,
      units: active.units,
      lifts,
      ids: () => ulid(),
      dayOrder: normalizeDayOrder(settings.dayOrder),
    });
    await db.workouts.bulkAdd(plan.addedWorkouts);
    await db.cycles.put({ ...active, includeDeload: true });
  });
}

/**
 * Remove the deload week from the active cycle (wraps core removeDeloadPlan).
 * Core throws if any week-4 workout has started.
 */
export async function removeDeloadFromActiveCycle(): Promise<void> {
  await db.transaction('rw', db.cycles, db.workouts, async () => {
    const active = await db.cycles.where('status').equals('active').first();
    if (!active) throw new Error('No active cycle.');
    // GUARD (week-4 footgun): StrongLifts sessions 10–12 carry week === 4.
    // Without this, removeDeloadPlan would DELETE the block's last nine rows.
    assertNotSlCycle(active, 'Removing the deload week');

    const existing = await db.workouts.where('cycleId').equals(active.id).toArray();
    const plan = removeDeloadPlan(existing);
    await db.workouts.bulkDelete(plan.removedWorkoutIds);
    await db.cycles.put({ ...active, includeDeload: false });
  });
}

// ---------------------------------------------------------------------------
// Program switching
// ---------------------------------------------------------------------------

/** Everything the Complete-Cycle modal collects when switching INTO StrongLifts. */
export interface CompleteCycleToSlArgs {
  /** Opening working weight per StrongLifts lift — all five, including the row. */
  weights: Record<SlLiftId, number>;
  /** Per-lift working-weight increment (`defaultSlIncrements` is the UI's starting point). */
  increments: Record<SlLiftId, number>;
  /**
   * ON (default in the UI) keeps ONE unbroken PR timeline, so a 5×5 top set can
   * beat a 5/3/1 record. OFF appends a reset marker to Settings.prResets.
   */
  keepPrs: boolean;
}

/**
 * Reject a StrongLifts opening weight or increment that could never train
 * anything. Mirrors `overrideSlLiftWeight`'s rule and its error style, because
 * it is the same rule: the two functions are the only writers of `sl.lifts`.
 *
 * A zero weight would stamp 5×0 rows into history and into the e1RM/PR series; a
 * zero increment would freeze the lift's progression forever (which is exactly
 * why `switchUnits` carries its own zero-increment fallback). Both are reachable
 * from a press-and-hold on a minus button, and neither is recoverable once the
 * block's 36 rows exist.
 */
function assertPositiveSlValue(value: number, what: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`A StrongLifts ${what} must be greater than zero.`);
  }
}

/**
 * Close the active 5/3/1 cycle and open a StrongLifts block in ITS PLACE, in ONE
 * transaction over `settings` + `cycles` + `workouts`.
 *
 * The transaction scope is deliberately MINIMAL: `liftState` and `tmEvents` are
 * NOT in it, which is a structural proof of the switch-in invariant — training
 * maxes go DORMANT rather than advancing, so no TmEvent is written and no
 * LiftState row is touched. The closed cycle's TMs ride along on the new cycle's
 * `tms` snapshot, ready for the switch back.
 *
 * Also: `includeDeload` is false (a block is 12 sessions, never 16), the 36 rows
 * are pending with LAZY weights, the armed `pendingProgramSwitch` is consumed,
 * and `keepPrs: false` appends the PR-reset marker.
 */
export async function completeCycleToSl(args: CompleteCycleToSlArgs): Promise<Cycle> {
  const { weights, increments, keepPrs } = args;

  // Validate BEFORE the transaction: nothing here reads the database, and a
  // rejection should never have opened one.
  for (const liftId of SL_LIFTS) {
    assertPositiveSlValue(weights[liftId], `${liftId} working weight`);
    assertPositiveSlValue(increments[liftId], `${liftId} increment`);
  }

  return db.transaction('rw', db.settings, db.cycles, db.workouts, async () => {
    const settings = await requireSettings();
    const active = await db.cycles.where('status').equals('active').first();
    if (!active) throw new Error('No active cycle to complete.');
    assertNotSlCycle(active, 'Switching to StrongLifts');

    const now = new Date().toISOString();

    // 1. Close out the 5/3/1 cycle. No TM advance, no audit event.
    await db.cycles.put({ ...active, status: 'completed', completedAt: now });

    // 2. Open the block, carrying the (now dormant) TM snapshot forward.
    const nextId = ulid();
    const nextCycle: Cycle = {
      id: nextId,
      number: active.number + 1,
      status: 'active',
      startedAt: now,
      tms: { ...active.tms },
      includeDeload: false,
      units: settings.units,
      program: 'sl5x5',
      sl: buildSlCycleState(weights, increments, keepPrs),
    };
    await db.cycles.add(nextCycle);

    // 3. 36 pending rows (12 sessions × 3 lifts), weights stamped lazily.
    await db.workouts.bulkAdd(
      buildSlCycleWorkouts({
        cycleId: nextId,
        cycleNumber: nextCycle.number,
        units: settings.units,
        ids: () => ulid(),
      }),
    );

    // 4. Consume the armed switch; record a PR reset if the user declined to keep them.
    await db.settings.put(settingsAfterProgramSwitch(settings, keepPrs, now));

    return nextCycle;
  });
}

/**
 * Close the active StrongLifts block and open ANOTHER one, in ONE transaction
 * over `cycles` + `workouts`. The runtime carries over VERBATIM — working
 * weights *and* fail streaks — because a block boundary is a calendar
 * convenience, not a training event: a lift two misses deep stays two misses
 * deep. Units come from the closed block itself, which is where its weights are
 * denominated.
 *
 * `settings` is deliberately out of scope: nothing here consumes an armed
 * switch (the user chose to keep going, so the arming survives for next time —
 * `clearPendingProgramSwitch` is the explicit disarm) and no PR reset happens.
 */
export async function completeSlCycleContinue(): Promise<Cycle> {
  return db.transaction('rw', db.cycles, db.workouts, async () => {
    const active = await db.cycles.where('status').equals('active').first();
    if (!active) throw new Error('No active cycle to complete.');
    const sl = requireSlRuntime(active);

    const now = new Date().toISOString();
    await db.cycles.put({ ...active, status: 'completed', completedAt: now });

    const nextId = ulid();
    const nextCycle: Cycle = {
      id: nextId,
      number: active.number + 1,
      status: 'active',
      startedAt: now,
      tms: { ...active.tms }, // still dormant, still riding along
      includeDeload: false,
      units: active.units,
      program: 'sl5x5',
      sl: { keepPrs: sl.keepPrs, lifts: copySlLifts(sl.lifts) },
    };
    await db.cycles.add(nextCycle);

    await db.workouts.bulkAdd(
      buildSlCycleWorkouts({
        cycleId: nextId,
        cycleNumber: nextCycle.number,
        units: active.units,
        ids: () => ulid(),
      }),
    );

    return nextCycle;
  });
}

/**
 * Close the active StrongLifts block and RETURN to 5/3/1, in ONE transaction
 * over `settings` + `cycles` + `liftState` + `tmEvents` + `workouts` — the same
 * shape as {@link completeCycle}, because that is exactly what this is: the TMs
 * wake up at the values the user confirmed.
 *
 * `finalTms` are taken AS DECIDED. The suggestion math
 * (`max(currentTm, round(0.9 × bestSlE1rm))`) belongs to the UI, which computes
 * it from the core helpers and lets the user override every row.
 *
 * `keepPrs` mirrors the switch in: true (default) leaves one unbroken record
 * timeline, false appends a reset marker. The armed switch is consumed either way.
 */
export async function completeSlCycleReturn(
  finalTms: Record<LiftId, number>,
  keepPrs = true,
): Promise<Cycle> {
  return db.transaction(
    'rw',
    db.settings,
    db.cycles,
    db.liftState,
    db.tmEvents,
    db.workouts,
    async () => {
      const settings = await requireSettings();
      const active = await db.cycles.where('status').equals('active').first();
      if (!active) throw new Error('No active cycle to complete.');
      requireSlRuntime(active);

      const now = new Date().toISOString();

      // 1. Close the block.
      await db.cycles.put({ ...active, status: 'completed', completedAt: now });

      // 2 + 3. Wake the TMs up: one audit event per lift, plus LiftState.
      for (const liftId of DAY_ORDER) {
        await db.tmEvents.add({
          id: ulid(),
          liftId,
          cycleId: active.id,
          timestamp: now,
          type: 'cycle_advance',
          fromValue: active.tms[liftId],
          toValue: finalTms[liftId],
          note: SL_RETURN_TM_NOTE,
        });
        await db.liftState.put({ liftId, trainingMax: finalTms[liftId] });
      }

      // 4. Open a normal 5/3/1 cycle, honoring the user's deload + day order.
      const nextId = ulid();
      const nextCycle: Cycle = {
        id: nextId,
        number: active.number + 1,
        status: 'active',
        startedAt: now,
        tms: { ...finalTms },
        includeDeload: settings.includeDeload,
        units: settings.units,
      };
      await db.cycles.add(nextCycle);

      await db.workouts.bulkAdd(
        buildCycleWorkouts({
          cycleId: nextId,
          cycleNumber: nextCycle.number,
          includeDeload: settings.includeDeload,
          units: settings.units,
          lifts: liftInputs(finalTms, settings.roundingIncrement),
          ids: () => ulid(),
          dayOrder: normalizeDayOrder(settings.dayOrder),
        }),
      );

      // 5. Consume the armed switch; record a PR reset if the user declined to keep them.
      await db.settings.put(settingsAfterProgramSwitch(settings, keepPrs, now));

      return nextCycle;
    },
  );
}

/**
 * Build the per-lift {tm, increment} record core cycle functions expect.
 * `roundingIncrement` is Settings.roundingIncrement — the WEIGHT-ROUNDING
 * increment for generated set weights (the per-lift TM bumps in
 * Settings.liftIncrements are progression-only and never rounded to).
 */
function liftInputs(
  tms: Record<LiftId, number>,
  roundingIncrement: number,
): Record<LiftId, CycleLiftInput> {
  return DAY_ORDER.reduce(
    (acc, liftId) => {
      acc[liftId] = { tm: tms[liftId], increment: roundingIncrement };
      return acc;
    },
    {} as Record<LiftId, CycleLiftInput>,
  );
}
