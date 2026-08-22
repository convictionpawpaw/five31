import type { LiftId, MainSet, SlLiftId, Workout } from '../../core/types.ts';
import { normalizeDayOrder } from '../../core/scheme.ts';

/**
 * Rank a lift by its position in the given training-day order. Accepts any
 * {@link SlLiftId} because it is fed `workout.liftId`; a lift not in the order
 * (i.e. the StrongLifts-only row) ranks last, exactly as any unknown id does.
 */
function dayRank(liftId: SlLiftId, order: readonly LiftId[]): number {
  const i = (order as readonly SlLiftId[]).indexOf(liftId);
  return i === -1 ? order.length : i;
}

/**
 * Build a comparator for stable within-cycle ordering: week ascending (1→4),
 * then the user's day order within a week. `dayOrder` is normalized (a malformed
 * or absent value falls back to the classic DAY_ORDER). Used to sort a cycle's
 * workouts for the grid and to pick the "earliest pending" workout on Today.
 */
export function makeWorkoutOrderComparator(
  dayOrder?: readonly LiftId[],
): (a: Workout, b: Workout) => number {
  const order = normalizeDayOrder(dayOrder);
  return (a, b) => {
    if (a.week !== b.week) return a.week - b.week;
    return dayRank(a.liftId, order) - dayRank(b.liftId, order);
  };
}

/**
 * Stable within-cycle ordering with the classic DAY_ORDER. Retained for callers
 * that do not (yet) thread a custom order; prefer {@link makeWorkoutOrderComparator}
 * with the user's `settings.dayOrder` for user-facing selection.
 */
export function compareWorkoutOrder(a: Workout, b: Workout): number {
  return makeWorkoutOrderComparator()(a, b);
}

/**
 * The next actionable workout in a cycle, respecting the user's `dayOrder`:
 *  1. any in_progress workout (earliest by week/day order), else
 *  2. the earliest pending workout (week 1→4, then the user's day order).
 * Returns null when every workout is completed or skipped (cycle resolved).
 */
export function selectNextWorkout(
  workouts: readonly Workout[],
  dayOrder?: readonly LiftId[],
): Workout | null {
  const ordered = [...workouts].sort(makeWorkoutOrderComparator(dayOrder));
  const inProgress = ordered.find((w) => w.status === 'in_progress');
  if (inProgress) return inProgress;
  const pending = ordered.find((w) => w.status === 'pending');
  return pending ?? null;
}

/** True iff every workout in the list is completed or skipped (cycle resolved). */
export function isCycleResolved(workouts: readonly Workout[]): boolean {
  return workouts.length > 0 && workouts.every((w) => w.status === 'completed' || w.status === 'skipped');
}

/**
 * The "top set" of a workout — the last work set (the AMRAP for weeks 1–3, the
 * heaviest deload set for week 4). Used for previews and grid cell weights.
 */
export function topWorkSet(w: Workout): MainSet | null {
  const work = w.mainSets.filter((s) => s.kind === 'work');
  return work.length > 0 ? work[work.length - 1]! : null;
}

/**
 * The most recently completed workout by completedAt (descending). Skipped and
 * unfinished workouts are ignored. Returns null if none completed.
 */
export function lastCompletedWorkout(workouts: readonly Workout[]): Workout | null {
  const completed = workouts.filter((w) => w.status === 'completed' && w.completedAt !== undefined);
  if (completed.length === 0) return null;
  completed.sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : a.completedAt! > b.completedAt! ? -1 : 0));
  return completed[0]!;
}

/** The AMRAP work set of a workout (weeks 1–3), or null (deload / not present). */
export function amrapSet(w: Workout): MainSet | null {
  return w.mainSets.find((s) => s.kind === 'work' && s.amrap) ?? null;
}
