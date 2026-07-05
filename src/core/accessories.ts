import type { AccessoryDef, AccessoryWork } from './types.ts';

/**
 * Double-progression rule: an accessory progresses (adds weight next time) iff
 * EVERY set hit the top of the rep range. Any set that is null/missing, or below
 * `repRangeMax`, blocks progression.
 *
 * `setReps` is expected to have length === `targetSets`. A shorter array (a
 * missing trailing set) also blocks progression.
 */
export function evaluateAccessoryProgression(
  setReps: readonly (number | null)[],
  targetSets: number,
  repRangeMax: number,
): boolean {
  if (setReps.length < targetSets) return false;

  for (let i = 0; i < targetSets; i++) {
    const reps = setReps[i];
    if (reps === null || reps === undefined || typeof reps !== 'number') return false;
    if (reps < repRangeMax) return false;
  }
  return true;
}

/**
 * Build the per-workout accessory snapshot from a definition. Weight is stamped
 * from the definition's `currentWeight` (lazily, when the workout starts), and
 * `setReps` is initialised to nulls of length `sets`. `progressed` starts false;
 * it is set at finishWorkout time from `evaluateAccessoryProgression`.
 */
export function buildAccessoryWork(def: AccessoryDef): AccessoryWork {
  return {
    accessoryId: def.id,
    name: def.name,
    weight: def.currentWeight,
    targetSets: def.sets,
    repRangeMin: def.repRangeMin,
    repRangeMax: def.repRangeMax,
    setReps: Array<number | null>(def.sets).fill(null),
    progressed: false,
  };
}
