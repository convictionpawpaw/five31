import { ulid } from 'ulid';
import type { LiftId } from '../../core/types.ts';
import { applyTmOverridePlan } from '../../core/cycle.ts';
import { db } from '../db.ts';
import { requireSettings } from './settingsRepo.ts';

/**
 * Apply a mid-cycle Training Max override for a single lift, in ONE transaction:
 *  - update LiftState (authoritative TM).
 *  - update the active Cycle's tms snapshot for that lift.
 *  - write a 'manual_override' TmEvent (from → to).
 *  - regenerate ONLY that lift's PENDING workouts (via core applyTmOverridePlan);
 *    completed / in_progress / skipped workouts keep their frozen weights.
 */
export async function applyTmOverride(liftId: LiftId, newTm: number): Promise<void> {
  await db.transaction(
    'rw',
    db.settings,
    db.liftState,
    db.cycles,
    db.tmEvents,
    db.workouts,
    async () => {
      const settings = await requireSettings();
      const active = await db.cycles.where('status').equals('active').first();
      if (!active) throw new Error('No active cycle for TM override.');

      const fromValue = active.tms[liftId];

      // Regenerate pending workouts for this lift. Set weights round to the
      // global roundingIncrement (NOT the lift's TM bump increment).
      const cycleWorkouts = await db.workouts.where('cycleId').equals(active.id).toArray();
      const plan = applyTmOverridePlan(cycleWorkouts, liftId, newTm, settings.roundingIncrement);
      if (plan.regeneratedWorkouts.length > 0) {
        await db.workouts.bulkPut(plan.regeneratedWorkouts);
      }

      // Update authoritative TM + the active cycle snapshot.
      await db.liftState.put({ liftId, trainingMax: newTm });
      await db.cycles.put({ ...active, tms: { ...active.tms, [liftId]: newTm } });

      // Audit event.
      await db.tmEvents.add({
        id: ulid(),
        liftId,
        cycleId: active.id,
        timestamp: new Date().toISOString(),
        type: 'manual_override',
        fromValue,
        toValue: newTm,
      });
    },
  );
}
