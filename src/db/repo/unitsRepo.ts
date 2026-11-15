import { ulid } from 'ulid';
import type {
  LiftId,
  SlCycleState,
  SlLiftRuntime,
  TmEvent,
  Units,
  Workout,
} from '../../core/types.ts';
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
 *    default increment) and write a 'unit_conversion' TmEvent per lift. A TM
 *    that is being switched straight BACK, untouched since the previous
 *    switch, is restored to its exact pre-conversion value instead (see
 *    {@link restoredTm}), so lb → kg → lb no longer drifts 135 → 130.
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
        const events = await db.tmEvents.where('liftId').equals(liftId).toArray();
        const converted =
          restoredTm(state.trainingMax, events, from, to) ?? convertTm(state.trainingMax);
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

      // 2. Active cycle: convert snapshot (plus any StrongLifts runtime), set
      //    units, and regenerate pending workouts.
      const active = await db.cycles.where('status').equals('active').first();
      if (active) {
        const convertedCycleTms = { ...active.tms };
        for (const liftId of DAY_ORDER) {
          convertedCycleTms[liftId] = newTms[liftId] ?? convertTm(active.tms[liftId]);
        }
        const convertedSl =
          active.sl === undefined ? undefined : convertSlState(active.sl, from, to, newRounding);
        await db.cycles.put({
          ...active,
          tms: convertedCycleTms,
          units: to,
          ...(convertedSl !== undefined ? { sl: convertedSl } : {}),
        });

        // A StrongLifts block regenerates NOTHING. Its stamped rows are frozen
        // history (they keep their own `units` and weights, like any completed
        // 5/3/1 workout) and its pending rows have no sets to regenerate — the
        // next start re-derives them from the converted `sl.lifts` above.
        // applyTmOverridePlan would also be plain wrong here: it rebuilds sets
        // from a TM percentage scheme StrongLifts does not use.
        //
        // What the block DOES need is a corrected LABEL on the rows that carry
        // no weight yet. `startSlSession` now stamps `units` from the cycle, so
        // the mismatch cannot reach history either way; relabelling here as well
        // means a never-stamped row is never even READ carrying a units field
        // that disagrees with the weights its block is now denominated in.
        if (active.program === 'sl5x5') {
          const blockRows = await db.workouts.where('cycleId').equals(active.id).toArray();
          const unstamped = blockRows.filter(
            (w) => isNeverStampedSlRow(w) && w.units !== to,
          );
          if (unstamped.length > 0) {
            await db.workouts.bulkPut(unstamped.map((w) => ({ ...w, units: to })));
          }
        } else {
          const cycleWorkouts = await db.workouts.where('cycleId').equals(active.id).toArray();
          // Regenerate pending workouts per lift with the converted TM. Set
          // weights round to the new unit's ROUNDING increment (not the per-lift
          // TM bumps, which are progression-only).
          for (const liftId of DAY_ORDER) {
            const plan = applyTmOverridePlan(
              cycleWorkouts,
              liftId,
              convertedCycleTms[liftId],
              newRounding,
            );
            // Stamp the new unit onto each regenerated (pending) workout.
            const regenerated = plan.regeneratedWorkouts.map((w) => ({ ...w, units: to }));
            if (regenerated.length > 0) await db.workouts.bulkPut(regenerated);
          }
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

/**
 * The exact TM to restore when a lift is switched straight back to the unit it
 * was last converted FROM, or null to convert normally.
 *
 * A restore happens only when ALL of these hold:
 *  - the lift's most recent TM event (by timestamp, then id) is a
 *    'unit_conversion' — so no override, cycle advance or re-onboarding has
 *    touched the TM since;
 *  - that conversion went `to → from` (its note, written as `${from}→${to}` by
 *    this function, says so; a missing or different note is not trusted);
 *  - the current TM still equals that event's `toValue` exactly, so nothing
 *    rewrote the TM without logging (an import, say);
 *  - its `fromValue` is a finite number above zero.
 *
 * Anything else converts normally. Only TRAINING MAXES have this audit log;
 * accessory weights/increments and StrongLifts working weights do not, and keep
 * converting (and re-rounding) on every switch.
 */
export function restoredTm(
  currentTm: number,
  events: readonly TmEvent[],
  from: Units,
  to: Units,
): number | null {
  if (events.length === 0) return null;
  const latest = [...events].sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
  )[events.length - 1]!;
  if (latest.type !== 'unit_conversion') return null;
  if (latest.note !== `${to}→${from}`) return null;
  if (latest.toValue !== currentTm) return null;
  const original = latest.fromValue;
  if (original === null || !Number.isFinite(original) || original <= 0) return null;
  return original;
}

/**
 * A StrongLifts row that has NEVER been stamped, and therefore holds no frozen
 * weight to protect: still pending, or skipped before it was ever started (which
 * leaves `tmUsed` 0 and `mainSets` empty, exactly as `buildSlCycleWorkouts` and
 * the un-skip rebuild produce). Anything else is history and stays frozen.
 */
function isNeverStampedSlRow(w: Workout): boolean {
  if (w.status === 'pending') return true;
  return w.status === 'skipped' && w.tmUsed === 0 && w.mainSets.length === 0;
}

/**
 * Convert a StrongLifts runtime into the new unit: BOTH the working weight and
 * the per-lift increment are converted and re-rounded to the new unit's rounding
 * increment. A degenerate zero increment (a tiny value that rounds away) falls
 * back to the unit default, exactly as accessory increments do — a zero
 * increment would freeze the lift's progression forever. Fail streaks are a
 * count, not a weight, and carry over untouched.
 */
function convertSlState(
  sl: SlCycleState,
  from: Units,
  to: Units,
  newRounding: number,
): SlCycleState {
  const convert = (rt: SlLiftRuntime): SlLiftRuntime => {
    const increment = roundToIncrement(convertWeight(rt.increment, from, to), newRounding);
    return {
      weight: roundToIncrement(convertWeight(rt.weight, from, to), newRounding),
      increment: increment > 0 ? increment : newRounding,
      failStreak: rt.failStreak,
    };
  };
  return {
    keepPrs: sl.keepPrs,
    lifts: {
      squat: convert(sl.lifts.squat),
      bench: convert(sl.lifts.bench),
      row: convert(sl.lifts.row),
      press: convert(sl.lifts.press),
      deadlift: convert(sl.lifts.deadlift),
    },
  };
}

/** Exposed for tests/tools: the per-lift CycleLiftInput after a conversion. */
export type ConvertedLiftInputs = Record<LiftId, CycleLiftInput>;
