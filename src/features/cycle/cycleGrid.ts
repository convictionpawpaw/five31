import type {
  LiftId,
  SlCycleState,
  SlSlot,
  WeekNumber,
  Workout,
  WorkoutStatus,
} from '../../core/types.ts';
import { normalizeDayOrder } from '../../core/scheme.ts';
import {
  SL_SESSIONS_PER_CYCLE,
  SL_SESSIONS_PER_WEEK,
  slSlotForSession,
  slWeekForSession,
} from '../../core/sl.ts';
import { topWorkSet } from '../shared/workoutSelect.ts';
import {
  buildSlSessionView,
  slSessionRows,
  type SlSessionStatus,
  type SlWeightBasis,
} from '../sl/slView.ts';

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

// ---------------------------------------------------------------------------
// StrongLifts grid
// ---------------------------------------------------------------------------

/** One cell of the StrongLifts grid: a whole SESSION, not a single lift. */
export interface SlGridCell {
  session: number;
  slot: SlSlot;
  /** The session's rows in performance order; empty on a malformed block. */
  workouts: Workout[];
  /** Aggregate status of the three rows — drives the cell glyph. */
  status: SlSessionStatus;
  /** The squat load (squat leads every session), stamped or projected. */
  squatWeight: number | null;
  /** Whether `squatWeight` is a forecast — the cell must say so. */
  basis: SlWeightBasis;
}

/** One row of the StrongLifts grid: a week and its three session cells. */
export interface SlGridRow {
  week: WeekNumber;
  cells: SlGridCell[];
}

/**
 * Arrange a StrongLifts block into 4 week-rows × 3 session-cells.
 *
 * Unlike {@link buildGrid} the axes are week × SESSION, not week × lift: a
 * StrongLifts session is trained (and skipped, and finished) as a unit, so the
 * cell is the unit of navigation. Each cell carries the SQUAT load, because
 * squat leads both slots and is therefore the one lift present in all twelve
 * cells. Unstamped sessions show a projection (`basis: 'projected'`).
 *
 * The grid is always the full 12 cells so the block's shape is legible from the
 * first session; a session with no rows still renders (status 'pending').
 */
export function buildSlGrid(
  workouts: readonly Workout[],
  sl?: SlCycleState,
): SlGridRow[] {
  const rows: SlGridRow[] = [];
  for (let session = 1; session <= SL_SESSIONS_PER_CYCLE; session++) {
    const week = slWeekForSession(session);
    const view = buildSlSessionView(workouts, session, sl);
    const squat = view.lifts.find((l) => l.liftId === 'squat') ?? null;

    const cell: SlGridCell = {
      session,
      slot: slSlotForSession(session),
      workouts: view.lifts.map((l) => l.workout),
      status: view.status,
      squatWeight: squat ? squat.weight : null,
      basis: squat ? squat.basis : 'projected',
    };

    const rowIndex = (session - 1) / SL_SESSIONS_PER_WEEK;
    const existing = rows[Math.floor(rowIndex)];
    if (existing) existing.cells.push(cell);
    else rows.push({ week, cells: [cell] });
  }
  return rows;
}

/**
 * Whether every one of the block's 36 rows is resolved — the SL complete-cycle
 * gate. Distinct from {@link allResolved} only in that it also insists every
 * session actually HAS rows, so a truncated import cannot unlock completion.
 */
export function slAllResolved(workouts: readonly Workout[]): boolean {
  for (let session = 1; session <= SL_SESSIONS_PER_CYCLE; session++) {
    const rows = slSessionRows(workouts, session);
    if (rows.length === 0) return false;
    if (!rows.every((w) => w.status === 'completed' || w.status === 'skipped')) return false;
  }
  return true;
}
