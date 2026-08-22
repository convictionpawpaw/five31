import type { SlLiftId, Units, Workout } from '../../core/types.ts';
import { epley } from '../../core/e1rm.ts';
import { convertWeight } from '../../core/units.ts';
import { computePrTimeline, type AmrapEffort } from '../../core/prs.ts';
import { amrapSet } from '../shared/workoutSelect.ts';

/**
 * Count main WORK sets and accessory sets that have not been logged yet.
 * Warmups don't count (they are optional). Used to gate the "N sets unlogged"
 * finish confirmation.
 */
export function countUnloggedSets(w: Workout): number {
  let n = 0;
  for (const s of w.mainSets) {
    if (s.kind === 'work' && s.actualReps === undefined) n += 1;
  }
  for (const a of w.accessoryWork) {
    for (const reps of a.setReps) {
      if (reps === null) n += 1;
    }
  }
  return n;
}

/**
 * Running best e1RM for a lift, computed over the AMRAP efforts of every
 * COMPLETED workout of that lift (chronological by completedAt), converted into
 * `targetUnits`. This is the record the live PR hint on the current workout must
 * beat. `excludeId` drops the workout currently being logged so its own (perhaps
 * partially entered) AMRAP never counts as the record to beat.
 */
export function bestE1rmForLift(
  workouts: readonly Workout[],
  liftId: SlLiftId,
  targetUnits: Units,
  excludeId?: string,
): number | null {
  const relevant = workouts
    .filter(
      (w) =>
        w.liftId === liftId &&
        w.status === 'completed' &&
        w.completedAt !== undefined &&
        w.id !== excludeId,
    )
    .sort((a, b) => (a.completedAt! < b.completedAt! ? -1 : a.completedAt! > b.completedAt! ? 1 : 0));

  let best: number | null = null;
  for (const w of relevant) {
    const set = amrapSet(w);
    if (!set || set.actualReps === undefined) continue;
    const weight = convertWeight(set.weight, w.units, targetUnits);
    const e1 = epley(weight, set.actualReps);
    if (e1 !== null && (best === null || e1 > best)) best = e1;
  }
  return best;
}

/**
 * Whether a completed workout's AMRAP effort set a personal record, evaluated
 * across ALL completed workouts of that lift (chronological). Used for the PR
 * badge on Today's last-completed summary and the workout summary.
 */
export function workoutSetPr(workouts: readonly Workout[], workout: Workout): boolean {
  if (workout.status !== 'completed') return false;
  const set = amrapSet(workout);
  if (!set || set.actualReps === undefined) return false;

  const relevant = workouts
    .filter((w) => w.liftId === workout.liftId && w.status === 'completed' && w.completedAt !== undefined)
    .sort((a, b) => (a.completedAt! < b.completedAt! ? -1 : a.completedAt! > b.completedAt! ? 1 : 0));

  const efforts: AmrapEffort[] = [];
  for (const w of relevant) {
    const s = amrapSet(w);
    if (!s || s.actualReps === undefined) continue;
    // Normalise every effort into THIS workout's units so the comparison is fair.
    const weight = convertWeight(s.weight, w.units, workout.units);
    efforts.push({ weight, reps: s.actualReps, ref: w.id });
  }

  const timeline = computePrTimeline(efforts);
  const entry = timeline.find((t) => t.ref === workout.id);
  return entry?.isPr ?? false;
}
