import { ulid } from 'ulid';
import type { LiftId, Units } from '../../core/types.ts';
import { DAY_ORDER } from '../../core/scheme.ts';
import { applyTmOverridePlan, type CycleLiftInput } from '../../core/cycle.ts';
import { convertWeight, defaultLiftIncrements, defaultRoundingIncrement } from '../../core/units.ts';
import { roundToIncrement } from '../../core/rounding.ts';
import { db, SETTINGS_ID } from '../db.ts';
import { requireSettings } from './settingsRepo.ts';

/**
 * Switch the app's weight units (lb ↔ kg) in ONE transaction. Converts all LIVE
 * state and regenerates pending workouts; historical (non-pending) workouts keep
 * their own `units` and frozen weights untouched.
 *
 * Steps:
 *  - convert each LiftState TM (convertWeight, re-rounded to the new unit's
 *    default increment) and write a 'unit_conversion' TmEvent per lift.
 *  - convert the active cycle's tms snapshot; set its units.
 *  - regenerate all PENDING workouts of the active cycle with the converted TMs
 *    (via core applyTmOverridePlan, per lift).
 *  - convert each AccessoryDef.currentWeight AND increment (re-rounded).
 *  - update Settings.units / roundingIncrement / liftIncrements.
 *
 * No-op (returns early) when `to` equals the current units.
 */
export async function switchUnits(to: Units): Promise<void> {
  await db.transaction(
    'rw',
    [db.settings, db.liftState, db.cycles, db.workouts, db.accessories, db.tmEvents],
    async () => {
      const settings = await requireSettings();
      const from = settings.units;
      if (from === to) return;

      const now = new Date().toISOString();
      const newRounding = defaultRoundingIncrement(to);
      const newLiftIncrements = defaultLiftIncrements(to);

      const convertTm = (w: number): number =>
        roundToIncrement(convertWeight(w, from, to), newRounding);

      // 1. LiftState + audit events.
      const newTms: Partial<Record<LiftId, number>> = {};
      for (const liftId of DAY_ORDER) {
        const state = await db.liftState.get(liftId);
        if (!state) continue;
        const converted = convertTm(state.trainingMax);
        newTms[liftId] = converted;
        await db.liftState.put({ liftId, trainingMax: converted });
        await db.tmEvents.add({
          id: ulid(),
          liftId,
          cycleId: null,
          timestamp: now,
          type: 'unit_conversion',
          fromValue: state.trainingMax,
          toValue: converted,
          note: `${from}→${to}`,
        });
      }

      // 2. Active cycle: convert snapshot, set units, regenerate pending workouts.
      const active = await db.cycles.where('status').equals('active').first();
      if (active) {
        const convertedCycleTms = { ...active.tms };
        for (const liftId of DAY_ORDER) {
          convertedCycleTms[liftId] = newTms[liftId] ?? convertTm(active.tms[liftId]);
        }
        await db.cycles.put({ ...active, tms: convertedCycleTms, units: to });

        const cycleWorkouts = await db.workouts.where('cycleId').equals(active.id).toArray();
        // Regenerate pending workouts per lift with the converted TM + new increment.
        for (const liftId of DAY_ORDER) {
          const plan = applyTmOverridePlan(
            cycleWorkouts,
            liftId,
            convertedCycleTms[liftId],
            newLiftIncrements[liftId],
          );
          // Stamp the new unit onto each regenerated (pending) workout.
          const regenerated = plan.regeneratedWorkouts.map((w) => ({ ...w, units: to }));
          if (regenerated.length > 0) await db.workouts.bulkPut(regenerated);
        }
      }

      // 3. Accessories: convert currentWeight + increment.
      const accessories = await db.accessories.toArray();
      for (const def of accessories) {
        const increment = roundToIncrement(
          convertWeight(def.increment, from, to),
          newRounding,
        );
        // A degenerate zero increment would break rounding; fall back to unit default.
        const safeIncrement = increment > 0 ? increment : newRounding;
        const currentWeight = roundToIncrement(
          convertWeight(def.currentWeight, from, to),
          safeIncrement,
        );
        await db.accessories.put({ ...def, currentWeight, increment: safeIncrement });
      }

      // 4. Settings.
      await db.settings.put({
        ...settings,
        id: SETTINGS_ID,
        units: to,
        roundingIncrement: newRounding,
        liftIncrements: newLiftIncrements,
      });
    },
  );
}

/** Exposed for tests/tools: the per-lift CycleLiftInput after a conversion. */
export type ConvertedLiftInputs = Record<LiftId, CycleLiftInput>;
