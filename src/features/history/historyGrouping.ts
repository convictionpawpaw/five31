import type { Cycle, SlLiftId, SlSlot, Units, Workout } from '../../core/types.ts';
import { convertWeight } from '../../core/units.ts';
import { computePrTimelineWithResets, type DatedEffort } from '../../core/prs.ts';
import { effortSet } from '../../core/efforts.ts';
import { SL_SLOT_LIFTS, slSlotForSession } from '../../core/sl.ts';

/** A resolved (completed or skipped) workout enriched for the history list. */
export interface HistoryRow {
  workout: Workout;
  /** True iff this workout's PR EFFORT set a personal record for its lift. */
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
 * Compute, for every COMPLETED workout of a lift, whether its PR EFFORT was a
 * record — evaluated across the whole (cross-cycle) history of that lift, in
 * completion order. Efforts are normalised into each workout's own units before
 * comparison so a unit switch mid-history doesn't corrupt the timeline.
 *
 * The effort is program-aware (`effortSet`): the AMRAP set on a 5/3/1 workout,
 * the best logged work set on a StrongLifts row. `resets` is Settings.prResets —
 * an empty/absent list is behaviour-identical to the classic single timeline,
 * and a non-empty one restarts the running max at each program switch while
 * leaving pre-reset badges exactly as they were earned.
 *
 * Returns a set of workout ids whose effort set a new record. Skipped workouts
 * and workouts with no logged effort never appear.
 */
export function computePrWorkoutIds(
  workouts: readonly Workout[],
  resets: readonly string[] = [],
): Set<string> {
  // Keyed by SlLiftId: the bucket key is `workout.liftId`, which now spans the
  // StrongLifts row as well. Grouping/PR math is unchanged.
  const byLift = new Map<SlLiftId, Workout[]>();
  for (const w of workouts) {
    if (w.status !== 'completed') continue;
    const set = effortSet(w);
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
    const efforts: DatedEffort[] = list.map((w) => {
      const set = effortSet(w)!;
      const weight = convertWeight(set.weight, w.units, refUnits);
      return { weight, reps: set.actualReps!, ref: w.id, at: completedKey(w) };
    });
    const timeline = computePrTimelineWithResets(efforts, resets);
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
  resets: readonly string[] = [],
): HistoryGroup[] {
  const prIds = computePrWorkoutIds(workouts, resets);

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

// ---------------------------------------------------------------------------
// StrongLifts session clustering
// ---------------------------------------------------------------------------

/** Whether a history group is a StrongLifts block (no TM summary, session rows). */
export function isSlCycle(cycle: Cycle): boolean {
  return cycle.program === 'sl5x5';
}

/** One StrongLifts session inside a history group: three lift sub-rows. */
export interface SlHistoryCluster {
  session: number;
  slot: SlSlot;
  /** Chronological key of the session (its earliest row) — the header date. */
  dateKey: string;
  /** The session's lift rows in PERFORMANCE order (squat first). */
  rows: HistoryRow[];
  /** True when every row was skipped — the cluster renders as SKIPPED. */
  skipped: boolean;
}

/**
 * Cluster a StrongLifts group's flat rows into SESSIONS, newest session first.
 *
 * The flat history list is per-workout, but a StrongLifts row on its own is
 * meaningless — squat 185×5 says nothing without the session it belonged to. So
 * rows are regrouped by `workout.session`, ordered within the cluster by the
 * slot's performance order, and the cluster header carries the session tag and
 * date. Rows with no `session` (i.e. not StrongLifts rows) are ignored.
 */
export function clusterSlRowsBySession(rows: readonly HistoryRow[]): SlHistoryCluster[] {
  const bySession = new Map<number, HistoryRow[]>();
  for (const row of rows) {
    const session = row.workout.session;
    if (session === undefined) continue;
    const list = bySession.get(session) ?? [];
    list.push(row);
    bySession.set(session, list);
  }

  const clusters: SlHistoryCluster[] = [];
  for (const [session, list] of bySession) {
    const slot = slSlotForSession(session);
    const order = SL_SLOT_LIFTS[slot];
    const ordered = [...list].sort(
      (a, b) =>
        (order as readonly SlLiftId[]).indexOf(a.workout.liftId) -
        (order as readonly SlLiftId[]).indexOf(b.workout.liftId),
    );
    const dateKey = ordered
      .map((r) => completedKey(r.workout))
      .reduce((a, b) => (a.localeCompare(b) <= 0 ? a : b));
    clusters.push({
      session,
      slot,
      dateKey,
      rows: ordered,
      skipped: ordered.every((r) => r.workout.status === 'skipped'),
    });
  }

  clusters.sort((a, b) => b.session - a.session);
  return clusters;
}
