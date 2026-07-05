import type { LiftId, MainSet, Workout } from '../../core/types.ts';
import { DAY_ORDER } from '../../core/scheme.ts';

/** Rank a lift by its position in the canonical training-day order. */
function dayRank(liftId: LiftId): number {
  const i = DAY_ORDER.indexOf(liftId);
  return i === -1 ? DAY_ORDER.length : i;
}

/**
 * Stable within-cycle ordering: week ascending (1→4), then DAY_ORDER within a
 * week (press → deadlift → bench → squat). Used to sort a cycle's workouts for
 * the grid and to pick the "earliest pending" workout on Today.
 */
export function compareWorkoutOrder(a: Workout, b: Workout): number {
  if (a.week !== b.week) return a.week - b.week;
  return dayRank(a.liftId) - dayRank(b.liftId);
}

/**
 * The next actionable workout in a cycle:
 *  1. any in_progress workout (earliest by week/day order), else
 *  2. the earliest pending workout (week 1→4, then DAY_ORDER).
 * Returns null when every workout is completed or skipped (cycle resolved).
 */
export function selectNextWorkout(workouts: readonly Workout[]): Workout | null {
  const ordered = [...workouts].sort(compareWorkoutOrder);
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
