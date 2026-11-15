import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, lbOnboardingPayload, resolveOneWorkout } from './setup.ts';
import { playSession, seedSlBlock } from './slHelpers.ts';
import { initializeFromOnboarding } from '../repo/onboardingRepo.ts';
import {
  completeCycle,
  completeSlCycleContinue,
  completeSlCycleReturn,
  getActiveCycle,
  getCycleWorkouts,
} from '../repo/cycleRepo.ts';
import { applyTmOverride } from '../repo/tmOverrideRepo.ts';
import { logMainSet, skipWorkout, startWorkout } from '../repo/workoutRepo.ts';
import { db } from '../db.ts';
import type { LiftId } from '../../core/types.ts';

beforeEach(resetDb);

const FINAL_TMS: Record<LiftId, number> = { press: 125, bench: 205, squat: 310, deadlift: 360 };

describe('completeCycle guards', () => {
  it('a repeated call with the same expected id cannot close the new cycle as a phantom', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const c1 = (await getActiveCycle())!;
    await resolveOneWorkout();

    const c2 = await completeCycle(FINAL_TMS, c1.id);
    await expect(completeCycle(FINAL_TMS, c1.id)).rejects.toThrow(/no longer the active cycle/);

    expect((await getActiveCycle())!.id).toBe(c2.id);
    expect(await db.cycles.count()).toBe(2);
  });

  it('without an expected id, a second call is still refused: the new cycle has nothing resolved', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    await resolveOneWorkout();
    const c2 = await completeCycle(FINAL_TMS);
    await expect(completeCycle(FINAL_TMS)).rejects.toThrow(/no completed or skipped workouts/);
    expect((await getActiveCycle())!.id).toBe(c2.id);
  });

  it('refuses a cycle with no resolved workouts', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    await expect(completeCycle(FINAL_TMS)).rejects.toThrow(/no completed or skipped workouts/);
    expect(await db.cycles.count()).toBe(1);
  });

  it('an in-progress workout alone does not count as resolved', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const c1 = (await getActiveCycle())!;
    const w = (await getCycleWorkouts(c1.id))[0]!;
    await startWorkout(w.id);
    await expect(completeCycle(FINAL_TMS, c1.id)).rejects.toThrow(/no completed or skipped/);
  });

  it('completing with every workout SKIPPED is still allowed', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const c1 = (await getActiveCycle())!;
    for (const w of await getCycleWorkouts(c1.id)) await skipWorkout(w.id);
    const c2 = await completeCycle(FINAL_TMS, c1.id);
    expect(c2.number).toBe(2);
  });

  it.each([
    ['NaN', Number.NaN],
    ['0', 0],
    ['negative', -5],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects a %s training max and changes nothing', async (_label, bad) => {
    await initializeFromOnboarding(lbOnboardingPayload());
    await resolveOneWorkout();
    const before = await db.liftState.toArray();
    await expect(completeCycle({ ...FINAL_TMS, squat: bad })).rejects.toThrow(
      /squat training max must be a number greater than zero/,
    );
    expect(await db.cycles.count()).toBe(1);
    expect(await db.liftState.toArray()).toEqual(before);
  });
});

describe('applyTmOverride guards', () => {
  it.each([
    ['NaN', Number.NaN],
    ['0', 0],
    ['negative', -100],
  ])('rejects a %s training max and changes nothing', async (_label, bad) => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const cycle = (await getActiveCycle())!;
    const workoutsBefore = await getCycleWorkouts(cycle.id);
    await expect(applyTmOverride('bench', bad)).rejects.toThrow(/greater than zero/);
    expect((await getActiveCycle())!.tms.bench).toBe(200);
    expect(await getCycleWorkouts(cycle.id)).toEqual(workoutsBefore);
    expect((await db.tmEvents.toArray()).filter((e) => e.type === 'manual_override')).toHaveLength(0);
  });
});

describe('StrongLifts completion guards', () => {
  it('completeSlCycleContinue refuses a stale expected id and an untrained block', async () => {
    const block = await seedSlBlock();
    await playSession(block.id, 1);
    const next = await completeSlCycleContinue(block.id);

    await expect(completeSlCycleContinue(block.id)).rejects.toThrow(/no longer the active cycle/);
    await expect(completeSlCycleContinue()).rejects.toThrow(/no completed or skipped workouts/);
    expect((await getActiveCycle())!.id).toBe(next.id);
  });

  it('completeSlCycleReturn refuses an invalid TM and a stale expected id', async () => {
    const block = await seedSlBlock();
    await playSession(block.id, 1);
    await expect(completeSlCycleReturn({ ...FINAL_TMS, press: 0 })).rejects.toThrow(
      /press training max/,
    );
    await expect(completeSlCycleReturn(FINAL_TMS, true, 'not-this-one')).rejects.toThrow(
      /no longer the active cycle/,
    );
    expect((await getActiveCycle())!.id).toBe(block.id);
  });
});

describe('workout guards: the workout must belong to the active cycle', () => {
  it('startWorkout and logMainSet refuse a pending workout of a completed cycle', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const c1 = (await getActiveCycle())!;
    const rows = await getCycleWorkouts(c1.id);
    await skipWorkout(rows[0]!.id);
    await completeCycle(FINAL_TMS, c1.id);

    const stale = rows[1]!; // still 'pending', but its cycle is closed
    await expect(startWorkout(stale.id)).rejects.toThrow(/not active/);
    await expect(logMainSet(stale.id, 'work', 0, 5)).rejects.toThrow(/not active/);
    expect((await db.workouts.get(stale.id))!.status).toBe('pending');
  });

  it('starting a second workout while one is in progress stays allowed (the UI does this)', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const rows = await getCycleWorkouts((await getActiveCycle())!.id);
    await startWorkout(rows[0]!.id);
    await startWorkout(rows[1]!.id);
    expect((await db.workouts.get(rows[1]!.id))!.status).toBe('in_progress');
  });
});
