// Shared fixtures for the StrongLifts FEATURE suites. Not a test file (the
// vitest include glob only picks up *.test.ts), so it may be imported freely.
//
// Deliberately builds rows by hand rather than through the repo: these suites
// are about the React-free view layer, so they stay free of Dexie and of the
// fake-indexeddb bootstrap the db suites need.
import type {
  Cycle,
  MainSet,
  SlCycleState,
  SlLiftId,
  SlLiftRuntime,
  Workout,
  WorkoutStatus,
} from '../../../core/types.ts';
import {
  SL_SESSIONS_PER_CYCLE,
  SL_SLOT_LIFTS,
  buildSlMainSets,
  defaultSlIncrements,
  slSlotForSession,
  slWeekForSession,
} from '../../../core/sl.ts';

/** Opening weights matching the db suites' fixture, so vectors line up. */
export const WEIGHTS: Record<SlLiftId, number> = {
  squat: 255,
  bench: 170,
  row: 135,
  press: 100,
  deadlift: 300,
};

/** A block runtime at the opening weights (no fail streaks). */
export function slState(
  weights: Partial<Record<SlLiftId, number>> = {},
  streaks: Partial<Record<SlLiftId, number>> = {},
): SlCycleState {
  const inc = defaultSlIncrements('lb');
  const lifts = {} as Record<SlLiftId, SlLiftRuntime>;
  for (const liftId of ['squat', 'bench', 'row', 'press', 'deadlift'] as const) {
    lifts[liftId] = {
      weight: weights[liftId] ?? WEIGHTS[liftId],
      increment: inc[liftId],
      failStreak: streaks[liftId] ?? 0,
    };
  }
  return { lifts, keepPrs: true };
}

/** One pending (unstamped) StrongLifts row, exactly as buildSlCycleWorkouts makes it. */
export function slRow(session: number, liftId: SlLiftId, status: WorkoutStatus = 'pending'): Workout {
  return {
    // cycleId matches `slCycle(2)`'s id, so a block and its rows group together.
    id: `s${session}-${liftId}`,
    cycleId: 'block-2',
    cycleNumber: 2,
    week: slWeekForSession(session),
    liftId,
    status,
    tmUsed: 0,
    mainSets: [],
    accessoryWork: [],
    units: 'lb',
    program: 'sl5x5',
    session,
    slSlot: slSlotForSession(session),
  };
}

/** The 36 pending rows of a fresh block. */
export function slBlock(): Workout[] {
  const out: Workout[] = [];
  for (let session = 1; session <= SL_SESSIONS_PER_CYCLE; session++) {
    for (const liftId of SL_SLOT_LIFTS[slSlotForSession(session)]) out.push(slRow(session, liftId));
  }
  return out;
}

/** Stamp a row at `weight` and log `reps` on every set (undefined = leave unlogged). */
export function stamp(row: Workout, weight: number, reps?: number, status: WorkoutStatus = 'in_progress'): Workout {
  const sets: MainSet[] = buildSlMainSets(weight, row.liftId).map((s) =>
    reps === undefined ? s : { ...s, actualReps: reps, loggedAt: '2026-07-12T10:00:00.000Z' },
  );
  return { ...row, status, tmUsed: weight, mainSets: sets, startedAt: '2026-07-12T09:00:00.000Z' };
}

/**
 * Replace one session's rows in a block with stamped/played ones. `reps` maps a
 * lift to the reps logged on every one of its sets; anything absent gets 5.
 */
export function playInBlock(
  block: readonly Workout[],
  session: number,
  opts: { status?: WorkoutStatus; reps?: Partial<Record<SlLiftId, number>>; weights?: Partial<Record<SlLiftId, number>>; completedAt?: string } = {},
): Workout[] {
  const status = opts.status ?? 'completed';
  return block.map((w) => {
    if (w.session !== session) return w;
    if (status === 'skipped') return { ...w, status };
    const weight = opts.weights?.[w.liftId] ?? WEIGHTS[w.liftId];
    const played = stamp(w, weight, opts.reps?.[w.liftId] ?? 5, status);
    return status === 'completed'
      ? { ...played, completedAt: opts.completedAt ?? `2026-07-${String(10 + session).padStart(2, '0')}T18:00:00.000Z` }
      : played;
  });
}

/** A StrongLifts cycle carrying a runtime. */
export function slCycle(number: number, sl: SlCycleState, status: Cycle['status'] = 'active'): Cycle {
  return {
    id: `block-${number}`,
    number,
    status,
    startedAt: `2026-0${number}-01T00:00:00.000Z`,
    tms: { press: 120, bench: 200, squat: 300, deadlift: 350 },
    includeDeload: false,
    units: 'lb',
    program: 'sl5x5',
    sl,
  };
}

/** A classic 5/3/1 cycle (no program key at all — the friend-path shape). */
export function classicCycle(number: number): Cycle {
  return {
    id: `cycle-${number}`,
    number,
    status: 'completed',
    startedAt: `2026-0${number}-01T00:00:00.000Z`,
    tms: { press: 120, bench: 200, squat: 300, deadlift: 350 },
    includeDeload: false,
    units: 'lb',
  };
}
