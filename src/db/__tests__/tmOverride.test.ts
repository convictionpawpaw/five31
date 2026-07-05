import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, lbOnboardingPayload } from './setup.ts';
import { initializeFromOnboarding } from '../repo/onboardingRepo.ts';
import { getActiveCycle, getCycleWorkouts } from '../repo/cycleRepo.ts';
import { startWorkout } from '../repo/workoutRepo.ts';
import { applyTmOverride } from '../repo/tmOverrideRepo.ts';
import { getLiftState } from '../repo/liftStateRepo.ts';
import { listTmEventsByLift } from '../repo/tmEventRepo.ts';
import { db } from '../db.ts';
import type { Workout } from '../../core/types.ts';

beforeEach(resetDb);

async function benchWorkouts(): Promise<Workout[]> {
  const cycle = await getActiveCycle();
  const all = await getCycleWorkouts(cycle!.id);
  return all.filter((w) => w.liftId === 'bench').sort((a, b) => a.week - b.week);
}

describe('applyTmOverride', () => {
  it('regenerates only the targeted lift PENDING workouts; started/other lifts untouched', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());

    // Start bench week 1 so it is in_progress and must NOT be regenerated.
    let bench = await benchWorkouts();
    const benchWk1 = bench.find((w) => w.week === 1)!;
    await startWorkout(benchWk1.id);

    // Snapshot a squat (other lift) pending workout to confirm it is untouched.
    const cycle = await getActiveCycle();
    const squatWk1Before = (await getCycleWorkouts(cycle!.id)).find(
      (w) => w.liftId === 'squat' && w.week === 1,
    )!;

    await applyTmOverride('bench', 220);

    bench = await benchWorkouts();
    const wk1 = bench.find((w) => w.week === 1)!;
    const wk2 = bench.find((w) => w.week === 2)!;
    const wk3 = bench.find((w) => w.week === 3)!;

    // In-progress week 1 keeps its old frozen TM (200).
    expect(wk1.status).toBe('in_progress');
    expect(wk1.tmUsed).toBe(200);

    // Pending weeks 2 & 3 regenerated at 220.
    expect(wk2.tmUsed).toBe(220);
    expect(wk3.tmUsed).toBe(220);
    // Week 2 @ 220 → 0.7/0.8/0.9 = 154/176/198 → 155/175/200.
    expect(wk2.mainSets.filter((s) => s.kind === 'work').map((s) => s.weight)).toEqual([
      155, 175, 200,
    ]);

    // Squat pending workout unchanged.
    const squatWk1After = (await getCycleWorkouts(cycle!.id)).find(
      (w) => w.liftId === 'squat' && w.week === 1,
    )!;
    expect(squatWk1After.tmUsed).toBe(squatWk1Before.tmUsed);
    expect(squatWk1After.mainSets).toEqual(squatWk1Before.mainSets);
  });

  it('updates LiftState and the active cycle tms snapshot, and writes a manual_override event', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    await applyTmOverride('bench', 220);

    expect((await getLiftState('bench'))!.trainingMax).toBe(220);
    const cycle = await getActiveCycle();
    expect(cycle!.tms.bench).toBe(220);
    // Other lifts in the snapshot unchanged.
    expect(cycle!.tms.squat).toBe(300);

    const events = await listTmEventsByLift('bench');
    const override = events.find((e) => e.type === 'manual_override')!;
    expect(override.fromValue).toBe(200);
    expect(override.toValue).toBe(220);
    expect(override.cycleId).toBe(cycle!.id);
  });

  it('does not touch completed workouts of the same lift', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const bench = await benchWorkouts();
    const wk1 = bench.find((w) => w.week === 1)!;
    // Mark completed directly (frozen at TM 200).
    await db.workouts.update(wk1.id, { status: 'completed' });

    await applyTmOverride('bench', 220);

    const wk1After = await db.workouts.get(wk1.id);
    expect(wk1After!.status).toBe('completed');
    expect(wk1After!.tmUsed).toBe(200); // untouched
  });
});
