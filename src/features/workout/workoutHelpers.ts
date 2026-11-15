import type { SlLiftId, Units, Workout } from '../../core/types.ts';
import { epley } from '../../core/e1rm.ts';
import { convertWeight } from '../../core/units.ts';
import { computePrTimelineWithResets, type DatedEffort } from '../../core/prs.ts';
import { effortSet } from '../../core/efforts.ts';

/** Chronological key for a completed workout: completedAt, else the ULID id. */
function completedKey(w: Workout): string {
  return w.completedAt ?? w.id;
}

/**
 * The most recent PR-reset boundary, or null when the slate has never been
 * wiped. Efforts before it belong to a CLOSED epoch and are no longer "the
 * record to beat" — which is what makes the live AMRAP hint honest after a
 * program switch with Keep PRs off.
 */
function lastReset(resets: readonly string[]): string | null {
  let latest: string | null = null;
  for (const at of resets) {
    if (latest === null || at.localeCompare(latest) > 0) latest = at;
  }
  return latest;
}

/**
 * The toast text for a failed write: the repo's own message when it threw an
 * Error (repo guards explain themselves), else the caller's fallback.
 */
export function writeErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.length > 0 ? err.message : fallback;
}

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
 * Running best e1RM for a lift, computed over the PR EFFORTS of every COMPLETED
 * workout of that lift (chronological by completedAt), converted into
 * `targetUnits`. The effort is program-aware (`effortSet`): the AMRAP set on a
 * 5/3/1 workout, the best logged work set on a StrongLifts row.
 *
 * This is the record the live PR hint on the current workout must beat.
 * `excludeId` drops the workout currently being logged so its own (perhaps
 * partially entered) effort never counts as the record to beat. `resets` is
 * Settings.prResets: efforts logged BEFORE the most recent reset belong to a
 * closed epoch and are excluded.
 */
export function bestE1rmForLift(
  workouts: readonly Workout[],
  liftId: SlLiftId,
  targetUnits: Units,
  excludeId?: string,
  resets: readonly string[] = [],
): number | null {
  const boundary = lastReset(resets);
  const relevant = workouts
    .filter(
      (w) =>
        w.liftId === liftId &&
        w.status === 'completed' &&
        w.completedAt !== undefined &&
        w.id !== excludeId &&
        (boundary === null || completedKey(w).localeCompare(boundary) >= 0),
    )
    .sort((a, b) => (a.completedAt! < b.completedAt! ? -1 : a.completedAt! > b.completedAt! ? 1 : 0));

  let best: number | null = null;
  for (const w of relevant) {
    const set = effortSet(w);
    if (!set || set.actualReps === undefined) continue;
    const weight = convertWeight(set.weight, w.units, targetUnits);
    const e1 = epley(weight, set.actualReps);
    if (e1 !== null && (best === null || e1 > best)) best = e1;
  }
  return best;
}

/**
 * Whether a completed workout's PR effort set a personal record, evaluated
 * across ALL completed workouts of that lift (chronological) and across PR
 * epochs (`resets` = Settings.prResets; empty behaves exactly as before). Used
 * for the PR badge on Today's last-session summary and the workout summary.
 */
export function workoutSetPr(
  workouts: readonly Workout[],
  workout: Workout,
  resets: readonly string[] = [],
): boolean {
  if (workout.status !== 'completed') return false;
  const set = effortSet(workout);
  if (!set || set.actualReps === undefined) return false;

  const relevant = workouts
    .filter((w) => w.liftId === workout.liftId && w.status === 'completed' && w.completedAt !== undefined)
    .sort((a, b) => (a.completedAt! < b.completedAt! ? -1 : a.completedAt! > b.completedAt! ? 1 : 0));

  const efforts: DatedEffort[] = [];
  for (const w of relevant) {
    const s = effortSet(w);
    if (!s || s.actualReps === undefined) continue;
    // Normalise every effort into THIS workout's units so the comparison is fair.
    const weight = convertWeight(s.weight, w.units, workout.units);
    efforts.push({ weight, reps: s.actualReps, ref: w.id, at: completedKey(w) });
  }

  const timeline = computePrTimelineWithResets(efforts, resets);
  const entry = timeline.find((t) => t.ref === workout.id);
  return entry?.isPr ?? false;
}
