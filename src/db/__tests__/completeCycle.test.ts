import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDb, lbOnboardingPayload, resolveOneWorkout } from './setup.ts';
import { initializeFromOnboarding } from '../repo/onboardingRepo.ts';
import { completeCycle, getActiveCycle, getCycleWorkouts, listCycles } from '../repo/cycleRepo.ts';
import { getAllLiftStates } from '../repo/liftStateRepo.ts';
import { listAllTmEvents } from '../repo/tmEventRepo.ts';
import { db } from '../db.ts';
import type { LiftId } from '../../core/types.ts';

beforeEach(resetDb);

const FINAL_TMS: Record<LiftId, number> = {
  press: 125, // +5
  bench: 205, // +5
  squat: 310, // +10
  deadlift: 360, // +10
};

describe('completeCycle', () => {
  it('closes the active cycle, updates TMs, writes cycle_advance events, opens Cycle 2', async () => {
    await initializeFromOnboarding(lbOnboardingPayload({ includeDeload: false }));
    const c1 = await getActiveCycle();

    await resolveOneWorkout();
    const c2 = await completeCycle(FINAL_TMS);

    // Old cycle completed.
    const c1After = await db.cycles.get(c1!.id);
    expect(c1After!.status).toBe('completed');
    expect(c1After!.completedAt).toBeDefined();

    // New cycle active with correct number, tms, 12 pending workouts.
    expect(c2.number).toBe(2);
    expect(c2.status).toBe('active');
    expect(c2.tms).toEqual(FINAL_TMS);
    const c2Workouts = await getCycleWorkouts(c2.id);
    expect(c2Workouts).toHaveLength(12);
    expect(c2Workouts.every((w) => w.status === 'pending')).toBe(true);
    // Bench week 1 @ new TM 205 → 0.65/0.75/0.85 = 133.25/153.75/174.25 → 135/155/175.
    const benchWk1 = c2Workouts.find((w) => w.liftId === 'bench' && w.week === 1)!;
    expect(benchWk1.tmUsed).toBe(205);
    expect(benchWk1.mainSets.filter((s) => s.kind === 'work').map((s) => s.weight)).toEqual([
      135, 155, 175,
    ]);

    // LiftState reflects the new TMs.
    const states = await getAllLiftStates();
    expect(states.find((s) => s.liftId === 'squat')!.trainingMax).toBe(310);

    // Exactly one active cycle now.
    const cycles = await listCycles();
    expect(cycles.filter((c) => c.status === 'active')).toHaveLength(1);
  });

  it('writes one cycle_advance TmEvent per lift (from → to)', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    await resolveOneWorkout();
    await completeCycle(FINAL_TMS);

    const advance = (await listAllTmEvents()).filter((e) => e.type === 'cycle_advance');
    expect(advance).toHaveLength(4);
    const press = advance.find((e) => e.liftId === 'press')!;
    expect(press.fromValue).toBe(120);
    expect(press.toValue).toBe(125);
    const squat = advance.find((e) => e.liftId === 'squat')!;
    expect(squat.fromValue).toBe(300);
    expect(squat.toValue).toBe(310);
  });

  it('inherits includeDeload / units from Settings for the next cycle', async () => {
    await initializeFromOnboarding(lbOnboardingPayload({ includeDeload: true }));
    await resolveOneWorkout();
    const c2 = await completeCycle(FINAL_TMS);
    expect(c2.includeDeload).toBe(true);
    expect(c2.units).toBe('lb');
    expect(await getCycleWorkouts(c2.id)).toHaveLength(16);
  });

  it('is all-or-nothing: a mid-transaction failure leaves the original cycle active', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const c1 = await getActiveCycle();
    await resolveOneWorkout();

    const spy = vi.spyOn(db.workouts, 'bulkAdd').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(completeCycle(FINAL_TMS)).rejects.toThrow('boom');
    spy.mockRestore();

    // Original cycle still the sole active one; no cycle_advance events; TMs unchanged.
    const active = await getActiveCycle();
    expect(active!.id).toBe(c1!.id);
    expect(active!.status).toBe('active');
    expect(await db.cycles.count()).toBe(1);
    expect((await listAllTmEvents()).filter((e) => e.type === 'cycle_advance')).toHaveLength(0);
    const states = await getAllLiftStates();
    expect(states.find((s) => s.liftId === 'press')!.trainingMax).toBe(120);
  });
});
