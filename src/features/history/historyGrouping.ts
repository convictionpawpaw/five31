import type { Cycle, SlLiftId, Units, Workout } from '../../core/types.ts';
import { convertWeight } from '../../core/units.ts';
import { computePrTimeline, type AmrapEffort } from '../../core/prs.ts';
import { amrapSet } from '../shared/workoutSelect.ts';

/** A resolved (completed or skipped) workout enriched for the history list. */
export interface HistoryRow {
  workout: Workout;
  /** True iff this workout's AMRAP effort set a personal record for its lift. */
  isPr: boolean;
}

/** One collapsible history group: a cycle and its resolved workouts. */
export interface HistoryGroup {
  cycle: Cycle;
  rows: HistoryRow[];
}

/** A resolved workout is completed or skipped. */
function isResolved(w: Workout): boolean {
  return w.status === 'completed' || w.status === 'skipped';
}

/**
 * Chronological sort key for a completed workout: prefer completedAt, else the
 * ULID id (also chronological). Used so PR flags are computed in the right order.
 */
function completedKey(w: Workout): string {
  return w.completedAt ?? w.id;
}

/**
 * Compute, for every COMPLETED workout of a lift, whether its AMRAP effort was a
 * PR — evaluated across the whole (cross-cycle) history of that lift, in
 * completion order. Efforts are normalised into each workout's own units before
 * comparison so a unit switch mid-history doesn't corrupt the timeline.
 *
 * Returns a set of workout ids whose AMRAP set a new record. Skipped workouts
 * and workouts with no logged AMRAP never appear.
 */
export function computePrWorkoutIds(workouts: readonly Workout[]): Set<string> {
  // Keyed by SlLiftId: the bucket key is `workout.liftId`, which now spans the
  // StrongLifts row as well. Grouping/PR math is unchanged.
  const byLift = new Map<SlLiftId, Workout[]>();
  for (const w of workouts) {
    if (w.status !== 'completed') continue;
    const set = amrapSet(w);
    if (!set || set.actualReps === undefined) continue;
    const list = byLift.get(w.liftId) ?? [];
    list.push(w);
    byLift.set(w.liftId, list);
  }

  const prIds = new Set<string>();
  for (const list of byLift.values()) {
    list.sort((a, b) => completedKey(a).localeCompare(completedKey(b)));
    // Reference units = the FIRST effort's units; normalise the rest to match.
    const refUnits: Units = list[0]!.units;
    const efforts: AmrapEffort[] = list.map((w) => {
      const set = amrapSet(w)!;
      const weight = convertWeight(set.weight, w.units, refUnits);
      return { weight, reps: set.actualReps!, ref: w.id };
    });
    const timeline = computePrTimeline(efforts);
    for (const entry of timeline) {
      if (entry.isPr && entry.ref !== undefined) prIds.add(entry.ref);
    }
  }
  return prIds;
}

/**
 * Group resolved (completed/skipped) workouts by cycle for the History screen.
 *
 *  - Only cycles that HAVE at least one resolved workout appear.
 *  - Groups are ordered by cycle number DESCENDING (newest first).
 *  - Within a group, rows are ordered by completion recency descending
 *    (completedAt, falling back to id); skipped workouts (no completedAt) sort
 *    by id, landing after same-keyed completed ones.
 *  - Each row carries an `isPr` flag from the cross-cycle PR timeline.
 */
export function groupHistoryByCycle(
  cycles: readonly Cycle[],
  workouts: readonly Workout[],
): HistoryGroup[] {
  const prIds = computePrWorkoutIds(workouts);

  const byCycle = new Map<string, Workout[]>();
  for (const w of workouts) {
    if (!isResolved(w)) continue;
    const list = byCycle.get(w.cycleId) ?? [];
    list.push(w);
    byCycle.set(w.cycleId, list);
  }

  const cyclesByNumberDesc = [...cycles].sort((a, b) => b.number - a.number);

  const groups: HistoryGroup[] = [];
  for (const cycle of cyclesByNumberDesc) {
    const list = byCycle.get(cycle.id);
    if (!list || list.length === 0) continue;
    list.sort((a, b) => completedKey(b).localeCompare(completedKey(a)));
    groups.push({
      cycle,
      rows: list.map((workout) => ({ workout, isPr: prIds.has(workout.id) })),
    });
  }
  return groups;
}
