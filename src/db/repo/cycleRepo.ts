import { ulid } from 'ulid';
import type { Cycle, LiftId, Workout } from '../../core/types.ts';
import { DAY_ORDER } from '../../core/scheme.ts';
import {
  addDeloadPlan,
  buildCycleWorkouts,
  removeDeloadPlan,
  type CycleLiftInput,
} from '../../core/cycle.ts';
import { db } from '../db.ts';
import { requireSettings } from './settingsRepo.ts';

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

    const existing = await db.workouts.where('cycleId').equals(active.id).toArray();
    const lifts = liftInputs(active.tms, settings.roundingIncrement);
    const plan = addDeloadPlan(existing, {
      cycleId: active.id,
      cycleNumber: active.number,
      units: active.units,
      lifts,
      ids: () => ulid(),
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

    const existing = await db.workouts.where('cycleId').equals(active.id).toArray();
    const plan = removeDeloadPlan(existing);
    await db.workouts.bulkDelete(plan.removedWorkoutIds);
    await db.cycles.put({ ...active, includeDeload: false });
  });
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
