import type { LiftId, WeekNumber, Workout, WorkoutStatus } from '../../core/types.ts';
import { normalizeDayOrder } from '../../core/scheme.ts';
import { topWorkSet } from '../shared/workoutSelect.ts';

/** One cell of the week×lift grid. */
export interface GridCell {
  liftId: LiftId;
  workout: Workout | null;
  status: WorkoutStatus | null;
  /** Top-set weight for the cell glyph (last work set), or null. */
  topWeight: number | null;
}

/** One row of the grid: a week and its four lift cells (in the user's day order). */
export interface GridRow {
  week: WeekNumber;
  cells: GridCell[];
}

/**
 * Arrange a cycle's workouts into a week×lift grid. Rows are the distinct weeks
 * present (ascending — 1,2,3, then 4/deload if any); columns follow the user's
 * `dayOrder` (normalized — absent/malformed falls back to the classic DAY_ORDER).
 * A missing workout yields an empty cell (defensive; a well-formed cycle is full).
 */
export function buildGrid(
  workouts: readonly Workout[],
  dayOrder?: readonly LiftId[],
): GridRow[] {
  const order = normalizeDayOrder(dayOrder);
  const weeks = Array.from(new Set(workouts.map((w) => w.week))).sort((a, b) => a - b);
  return weeks.map((week) => ({
    week,
    cells: order.map((liftId): GridCell => {
      const workout = workouts.find((w) => w.week === week && w.liftId === liftId) ?? null;
      const top = workout ? topWorkSet(workout) : null;
      return {
        liftId,
        workout,
        status: workout?.status ?? null,
        topWeight: top?.weight ?? null,
      };
    }),
  }));
}

/** Whether the cycle has a deload (week-4) row. */
export function hasDeload(workouts: readonly Workout[]): boolean {
  return workouts.some((w) => w.week === 4);
}

/** Whether every week-4 workout is still pending (deload is removable). */
export function deloadRemovable(workouts: readonly Workout[]): boolean {
  const week4 = workouts.filter((w) => w.week === 4);
  return week4.length > 0 && week4.every((w) => w.status === 'pending');
}

/** Whether every workout is resolved (completed/skipped) — complete-cycle gate. */
export function allResolved(workouts: readonly Workout[]): boolean {
  return workouts.length > 0 && workouts.every((w) => w.status === 'completed' || w.status === 'skipped');
}
