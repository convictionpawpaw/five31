import type { Cycle, Settings, Workout } from '../../core/types.ts';
import type { WarmupLift } from '../../core/stretch/types.ts';
import { isWarmupLift } from '../../core/stretch/modes.ts';
import {
  earliestUnresolvedSlSession,
  getActiveCycle,
  getCycleWorkouts,
  getSettings,
} from '../../db/repo/index.ts';
import { selectNextWorkout } from '../shared/workoutSelect.ts';

/**
 * The barbell lift of the next lifting workout, the one Today shows: the next
 * 5/3/1 workout's lift, or for a StrongLifts session its first lift (squat,
 * which every session opens with). Null when there is no next workout.
 */
export function nextWarmupLift(
  settings: Settings | null | undefined,
  cycle: Cycle | null | undefined,
  workouts: readonly Workout[],
): WarmupLift | null {
  if (!settings || !cycle) return null;
  if (cycle.program === 'sl5x5') {
    const session = earliestUnresolvedSlSession(workouts);
    if (session === null) return null;
    const lifts = workouts.filter((w) => w.session === session).map((w) => w.liftId);
    if (lifts.includes('squat')) return 'squat';
    return lifts.find(isWarmupLift) ?? null;
  }
  const next = selectNextWorkout(workouts, settings.dayOrder);
  return next && isWarmupLift(next.liftId) ? next.liftId : null;
}

/** {@link nextWarmupLift} read from the database (for a live query). */
export async function readNextWarmupLift(): Promise<WarmupLift | null> {
  const settings = await getSettings();
  const cycle = await getActiveCycle();
  const workouts = cycle ? await getCycleWorkouts(cycle.id) : [];
  return nextWarmupLift(settings, cycle, workouts);
}
