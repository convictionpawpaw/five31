import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, lbOnboardingPayload } from './setup.ts';
import { initializeFromOnboarding } from '../repo/onboardingRepo.ts';
import { getActiveCycle, getCycleWorkouts } from '../repo/cycleRepo.ts';
import { startWorkout, logMainSet, finishWorkout } from '../repo/workoutRepo.ts';
import { switchUnits } from '../repo/unitsRepo.ts';
import { getSettings } from '../repo/settingsRepo.ts';
import { getLiftState } from '../repo/liftStateRepo.ts';
import { listTmEventsByLift } from '../repo/tmEventRepo.ts';
import { db } from '../db.ts';
import { convertWeight } from '../../core/units.ts';
import { roundToIncrement } from '../../core/rounding.ts';
import type { Workout } from '../../core/types.ts';

beforeEach(resetDb);

describe('switchUnits (lb → kg)', () => {
  it('converts live state, regenerates pending, leaves completed workouts untouched', async () => {
    await initializeFromOnboarding(
      lbOnboardingPayload({
        accessories: [
          { liftDayId: 'bench', name: 'Dips', sets: 3, repRangeMin: 8, repRangeMax: 12, currentWeight: 100, increment: 5 },
        ],
      }),
    );

    // Complete a bench workout so it becomes historical (must keep lb + weights).
    const cycle = await getActiveCycle();
    const bench = (await getCycleWorkouts(cycle!.id)).find(
      (w) => w.liftId === 'bench' && w.week === 1,
    )!;
    await startWorkout(bench.id);
    await logMainSet(bench.id, 'work', 2, 8);
    await finishWorkout(bench.id);
    const completedBefore = (await db.workouts.get(bench.id))!;

    await switchUnits('kg');

    // Settings updated.
    const settings = await getSettings();
    expect(settings!.units).toBe('kg');
    expect(settings!.roundingIncrement).toBe(2.5);
    expect(settings!.liftIncrements).toEqual({ press: 2.5, bench: 2.5, squat: 5, deadlift: 5 });

    // LiftState converted + rounded to 2.5.
    const squat = await getLiftState('squat');
    const expectedSquat = roundToIncrement(convertWeight(300, 'lb', 'kg'), 2.5);
    expect(squat!.trainingMax).toBe(expectedSquat);

    // Active cycle snapshot + units converted.
    const activeCycle = await getActiveCycle();
    expect(activeCycle!.units).toBe('kg');
    expect(activeCycle!.tms.squat).toBe(expectedSquat);

    // Pending workouts regenerated in kg with converted TMs.
    const squatPending = (await getCycleWorkouts(activeCycle!.id)).find(
      (w) => w.liftId === 'squat' && w.week === 1,
    )!;
    expect(squatPending.units).toBe('kg');
    expect(squatPending.tmUsed).toBe(expectedSquat);

    // Completed bench workout is UNTOUCHED (still lb, same frozen weights).
    const completedAfter = (await db.workouts.get(bench.id))!;
    expect(completedAfter.units).toBe('lb');
    expect(completedAfter.tmUsed).toBe(completedBefore.tmUsed);
    expect(completedAfter.mainSets).toEqual(completedBefore.mainSets);

    // Accessory converted.
    const dips = (await db.accessories.toArray())[0]!;
    const expectedDips = roundToIncrement(convertWeight(100, 'lb', 'kg'), 2.5);
    expect(dips.currentWeight).toBe(expectedDips);
    expect(dips.increment).toBe(2.5);

    // A unit_conversion TmEvent per lift.
    const benchEvents = await listTmEventsByLift('bench');
    expect(benchEvents.some((e) => e.type === 'unit_conversion')).toBe(true);
  });

  it('is a no-op when the target unit equals the current unit', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const before = await db.tmEvents.count();
    await switchUnits('lb');
    expect(await db.tmEvents.count()).toBe(before); // no new conversion events
    expect((await getSettings())!.units).toBe('lb');
  });

  it('regenerated pending workouts recompute set weights from the converted TM', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    await switchUnits('kg');

    const cycle = await getActiveCycle();
    const pressPending = (await getCycleWorkouts(cycle!.id)).find(
      (w) => w.liftId === 'press' && w.week === 1,
    ) as Workout;

    const tmKg = roundToIncrement(convertWeight(120, 'lb', 'kg'), 2.5);
    // Week 1 work percentages 65/75/85 of the converted TM, rounded to 2.5.
    const expected = [0.65, 0.75, 0.85].map((p) => roundToIncrement(tmKg * p, 2.5));
    expect(pressPending.mainSets.filter((s) => s.kind === 'work').map((s) => s.weight)).toEqual(
      expected,
    );
  });
});
