import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, lbOnboardingPayload } from './setup.ts';
import { initializeFromOnboarding } from '../repo/onboardingRepo.ts';
import { getActiveCycle, getCycleWorkouts } from '../repo/cycleRepo.ts';
import {
  startWorkout,
  logMainSet,
  logAccessorySet,
  finishWorkout,
  getWorkout,
  skipWorkout,
  unskipWorkout,
  setNotes,
} from '../repo/workoutRepo.ts';
import { db } from '../db.ts';
import type { Workout } from '../../core/types.ts';

beforeEach(resetDb);

/** Onboard with two bench accessories, return the pending bench week-1 workout. */
async function onboardWithBenchAccessories(): Promise<Workout> {
  await initializeFromOnboarding(
    lbOnboardingPayload({
      accessories: [
        // rep ceiling = repRangeMax = 12; 3 sets.
        { liftDayId: 'bench', name: 'Dips', sets: 3, repRangeMin: 8, repRangeMax: 12, currentWeight: 40, increment: 5 },
        { liftDayId: 'bench', name: 'Rows', sets: 3, repRangeMin: 8, repRangeMax: 12, currentWeight: 100, increment: 5 },
      ],
    }),
  );
  const cycle = await getActiveCycle();
  const workouts = await getCycleWorkouts(cycle!.id);
  return workouts.find((w) => w.liftId === 'bench' && w.week === 1)!;
}

describe('workout lifecycle', () => {
  it('startWorkout stamps accessoryWork from active defs, in order, at current weight', async () => {
    const bench = await onboardWithBenchAccessories();
    await startWorkout(bench.id);

    const started = await getWorkout(bench.id);
    expect(started!.status).toBe('in_progress');
    expect(started!.startedAt).toBeDefined();
    expect(started!.accessoryWork.map((a) => a.name)).toEqual(['Dips', 'Rows']);
    expect(started!.accessoryWork[0]!.weight).toBe(40);
    expect(started!.accessoryWork[0]!.setReps).toEqual([null, null, null]);
    expect(started!.accessoryWork[0]!.progressed).toBe(false);
  });

  it('logging the first main set on a pending workout auto-starts it', async () => {
    const bench = await onboardWithBenchAccessories();
    expect(bench.status).toBe('pending');
    await logMainSet(bench.id, 'work', 0, 5);
    const w = await getWorkout(bench.id);
    expect(w!.status).toBe('in_progress');
    expect(w!.startedAt).toBeDefined();
    expect(w!.accessoryWork).toHaveLength(2); // stamped on auto-start
    const set = w!.mainSets.find((s) => s.kind === 'work' && s.index === 0)!;
    expect(set.actualReps).toBe(5);
    expect(set.loggedAt).toBeDefined();
  });

  it('finish bumps an accessory at its rep ceiling exactly once, and only the passing one', async () => {
    const bench = await onboardWithBenchAccessories();
    await startWorkout(bench.id);

    // Log the AMRAP so the main work is "done".
    await logMainSet(bench.id, 'work', 2, 8);
    // Dips (index 0): all sets hit ceiling (12) → should progress 40 → 45.
    await logAccessorySet(bench.id, 0, 0, 12);
    await logAccessorySet(bench.id, 0, 1, 12);
    await logAccessorySet(bench.id, 0, 2, 12);
    // Rows (index 1): one set short (11 < 12) → must NOT progress.
    await logAccessorySet(bench.id, 1, 0, 12);
    await logAccessorySet(bench.id, 1, 1, 11);
    await logAccessorySet(bench.id, 1, 2, 12);

    await finishWorkout(bench.id);

    const w = await getWorkout(bench.id);
    expect(w!.status).toBe('completed');
    expect(w!.completedAt).toBeDefined();
    expect(w!.accessoryWork[0]!.progressed).toBe(true);
    expect(w!.accessoryWork[1]!.progressed).toBe(false);

    const dips = await db.accessories.get(w!.accessoryWork[0]!.accessoryId);
    const rows = await db.accessories.get(w!.accessoryWork[1]!.accessoryId);
    expect(dips!.currentWeight).toBe(45); // bumped once by +5
    expect(rows!.currentWeight).toBe(100); // untouched
  });

  it('double-finish throws and never bumps the accessory twice', async () => {
    const bench = await onboardWithBenchAccessories();
    await startWorkout(bench.id);
    await logAccessorySet(bench.id, 0, 0, 12);
    await logAccessorySet(bench.id, 0, 1, 12);
    await logAccessorySet(bench.id, 0, 2, 12);
    await finishWorkout(bench.id);

    const dips1 = await db.accessories.get((await getWorkout(bench.id))!.accessoryWork[0]!.accessoryId);
    expect(dips1!.currentWeight).toBe(45);

    // Second finish must throw (status is now 'completed', not 'in_progress').
    await expect(finishWorkout(bench.id)).rejects.toThrow();

    const dips2 = await db.accessories.get(dips1!.id);
    expect(dips2!.currentWeight).toBe(45); // still one bump only
  });

  it('setNotes writes through', async () => {
    const bench = await onboardWithBenchAccessories();
    await setNotes(bench.id, 'felt strong');
    expect((await getWorkout(bench.id))!.notes).toBe('felt strong');
  });

  it('skip / unskip round-trips while the cycle is active', async () => {
    const bench = await onboardWithBenchAccessories();
    await skipWorkout(bench.id);
    expect((await getWorkout(bench.id))!.status).toBe('skipped');
    await unskipWorkout(bench.id);
    expect((await getWorkout(bench.id))!.status).toBe('pending');
  });

  it('logging on a completed workout is rejected', async () => {
    const bench = await onboardWithBenchAccessories();
    await startWorkout(bench.id);
    await finishWorkout(bench.id);
    await expect(logMainSet(bench.id, 'work', 0, 5)).rejects.toThrow();
  });

  it('accessory bump adds exactly +increment from an off-grid start (finding 11)', async () => {
    // Regression: an off-grid currentWeight (52, default increment 5) must bump
    // to 57 (plain addition), NOT snap onto the increment grid (which gave 55).
    await initializeFromOnboarding(
      lbOnboardingPayload({
        accessories: [
          { liftDayId: 'bench', name: 'Curl', sets: 3, repRangeMin: 8, repRangeMax: 12, currentWeight: 52, increment: 5 },
        ],
      }),
    );
    const cycle = await getActiveCycle();
    const bench = (await getCycleWorkouts(cycle!.id)).find(
      (w) => w.liftId === 'bench' && w.week === 1,
    )!;
    await startWorkout(bench.id);
    await logMainSet(bench.id, 'work', 2, 8);
    await logAccessorySet(bench.id, 0, 0, 12);
    await logAccessorySet(bench.id, 0, 1, 12);
    await logAccessorySet(bench.id, 0, 2, 12);
    await finishWorkout(bench.id);

    const curl = await db.accessories.get(
      (await getWorkout(bench.id))!.accessoryWork[0]!.accessoryId,
    );
    expect(curl!.currentWeight).toBe(57); // 52 + 5, offset preserved
  });

  it('unskip → reopen preserves already-logged accessory reps (finding 16)', async () => {
    const bench = await onboardWithBenchAccessories();
    await startWorkout(bench.id);
    // Log some accessory reps, then skip and unskip.
    await logAccessorySet(bench.id, 0, 0, 10);
    await logAccessorySet(bench.id, 0, 1, 11);
    await skipWorkout(bench.id);
    await unskipWorkout(bench.id);
    expect((await getWorkout(bench.id))!.status).toBe('pending');

    // Reopening (via startWorkout OR the first main-set log) must NOT wipe the
    // logged accessory reps by re-stamping from live defs.
    await startWorkout(bench.id);
    const reopened = await getWorkout(bench.id);
    expect(reopened!.status).toBe('in_progress');
    expect(reopened!.accessoryWork[0]!.setReps.slice(0, 2)).toEqual([10, 11]);
  });

  it('logMainSet on an unskipped workout with logged accessories keeps them (finding 16)', async () => {
    const bench = await onboardWithBenchAccessories();
    await startWorkout(bench.id);
    await logAccessorySet(bench.id, 1, 0, 9); // Rows set 1
    await skipWorkout(bench.id);
    await unskipWorkout(bench.id);
    // Re-enter via a main-set log (auto-start branch) — accessory reps survive.
    await logMainSet(bench.id, 'work', 0, 5);
    const w = await getWorkout(bench.id);
    expect(w!.status).toBe('in_progress');
    expect(w!.accessoryWork[1]!.setReps[0]).toBe(9);
  });

  it('re-stamps accessoryWork when an unskipped workout had NO logged reps', async () => {
    // The preservation guard must not freeze a snapshot that carries no data:
    // a start with empty reps should still reflect current def weights.
    const bench = await onboardWithBenchAccessories();
    await startWorkout(bench.id); // stamps empty accessoryWork
    await skipWorkout(bench.id);
    await unskipWorkout(bench.id);
    await startWorkout(bench.id);
    const w = await getWorkout(bench.id);
    expect(w!.accessoryWork.map((a) => a.name)).toEqual(['Dips', 'Rows']);
    expect(w!.accessoryWork.every((a) => a.setReps.every((r) => r === null))).toBe(true);
  });
});
