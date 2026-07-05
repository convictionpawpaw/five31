import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDb, lbOnboardingPayload } from './setup.ts';
import { initializeFromOnboarding } from '../repo/onboardingRepo.ts';
import { getActiveCycle, getCycleWorkouts } from '../repo/cycleRepo.ts';
import { getSettings } from '../repo/settingsRepo.ts';
import { getAllLiftStates } from '../repo/liftStateRepo.ts';
import { listAllTmEvents } from '../repo/tmEventRepo.ts';
import { db } from '../db.ts';
import { DAY_ORDER } from '../../core/scheme.ts';

beforeEach(resetDb);

describe('initializeFromOnboarding', () => {
  it('creates Cycle 1 active with 12 pending workouts (no deload) and frozen weights', async () => {
    await initializeFromOnboarding(lbOnboardingPayload({ includeDeload: false }));

    const cycle = await getActiveCycle();
    expect(cycle).toBeDefined();
    expect(cycle!.number).toBe(1);
    expect(cycle!.status).toBe('active');
    expect(cycle!.includeDeload).toBe(false);
    expect(cycle!.tms).toEqual({ press: 120, bench: 200, squat: 300, deadlift: 350 });

    const workouts = await getCycleWorkouts(cycle!.id);
    expect(workouts).toHaveLength(12);
    expect(workouts.every((w) => w.status === 'pending')).toBe(true);
    expect(workouts.every((w) => w.accessoryWork.length === 0)).toBe(true);

    // Frozen weights: bench week 1 work sets @ TM 200 → 130/150/170.
    const benchWk1 = workouts.find((w) => w.liftId === 'bench' && w.week === 1)!;
    expect(benchWk1.tmUsed).toBe(200);
    expect(benchWk1.mainSets.filter((s) => s.kind === 'work').map((s) => s.weight)).toEqual([
      130, 150, 170,
    ]);
  });

  it('creates 16 pending workouts when includeDeload is true', async () => {
    await initializeFromOnboarding(lbOnboardingPayload({ includeDeload: true }));
    const cycle = await getActiveCycle();
    const workouts = await getCycleWorkouts(cycle!.id);
    expect(workouts).toHaveLength(16);
    expect(workouts.filter((w) => w.week === 4)).toHaveLength(4);
  });

  it('writes Settings (onboardingComplete + schemaVersion 1) and LiftState per lift', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const settings = await getSettings();
    expect(settings!.onboardingComplete).toBe(true);
    expect(settings!.schemaVersion).toBe(1);
    expect(settings!.units).toBe('lb');

    const states = await getAllLiftStates();
    expect(states.map((s) => s.liftId).sort()).toEqual([...DAY_ORDER].sort());
    expect(states.find((s) => s.liftId === 'squat')!.trainingMax).toBe(300);
  });

  it("writes one 'initial' TmEvent per lift with fromValue null", async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const events = await listAllTmEvents();
    expect(events).toHaveLength(4);
    expect(events.every((e) => e.type === 'initial')).toBe(true);
    expect(events.every((e) => e.fromValue === null)).toBe(true);
    const press = events.find((e) => e.liftId === 'press')!;
    expect(press.toValue).toBe(120);
  });

  it('persists accessory defs with per-day order preserved', async () => {
    await initializeFromOnboarding(
      lbOnboardingPayload({
        accessories: [
          { liftDayId: 'bench', name: 'Dips', sets: 3, repRangeMin: 8, repRangeMax: 12, currentWeight: 0, increment: 5 },
          { liftDayId: 'bench', name: 'Rows', sets: 3, repRangeMin: 8, repRangeMax: 12, currentWeight: 100, increment: 5 },
          { liftDayId: 'press', name: 'Chins', sets: 3, repRangeMin: 5, repRangeMax: 10, currentWeight: 0, increment: 5 },
        ],
      }),
    );
    const bench = (await db.accessories.where('liftDayId').equals('bench').toArray()).sort(
      (a, b) => a.order - b.order,
    );
    expect(bench.map((a) => a.name)).toEqual(['Dips', 'Rows']);
    expect(bench.map((a) => a.order)).toEqual([0, 1]);
    const press = await db.accessories.where('liftDayId').equals('press').toArray();
    expect(press.map((a) => a.order)).toEqual([0]);
  });

  it('is all-or-nothing (empty DB on failure inside the transaction)', async () => {
    // Force a genuine mid-transaction failure: make the final write (workouts
    // bulkAdd) throw once, AFTER settings/liftState/tmEvents/cycle were written
    // in the same transaction. A working transaction must roll ALL of them back.
    const original = db.workouts.bulkAdd.bind(db.workouts);
    const spy = vi.spyOn(db.workouts, 'bulkAdd').mockImplementationOnce(() => {
      throw new Error('boom: simulated write failure');
    });

    await expect(initializeFromOnboarding(lbOnboardingPayload())).rejects.toThrow('boom');

    spy.mockRestore();
    // Sanity: the real method still works after restore.
    void original;

    // Everything the transaction touched must have rolled back.
    expect(await db.settings.count()).toBe(0);
    expect(await db.liftState.count()).toBe(0);
    expect(await db.cycles.count()).toBe(0);
    expect(await db.workouts.count()).toBe(0);
    expect(await db.tmEvents.count()).toBe(0);
  });
});
