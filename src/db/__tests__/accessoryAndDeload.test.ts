import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, lbOnboardingPayload } from './setup.ts';
import { initializeFromOnboarding } from '../repo/onboardingRepo.ts';
import {
  addAccessory,
  updateAccessory,
  reorderAccessories,
  archiveAccessory,
  unarchiveAccessory,
  listActiveAccessories,
  MAX_ACTIVE_ACCESSORIES_PER_DAY,
} from '../repo/accessoryRepo.ts';
import {
  addDeloadToActiveCycle,
  removeDeloadFromActiveCycle,
  getActiveCycle,
  getCycleWorkouts,
} from '../repo/cycleRepo.ts';
import { startWorkout } from '../repo/workoutRepo.ts';

beforeEach(resetDb);

function newAcc(name: string, order?: number) {
  return {
    liftDayId: 'bench' as const,
    name,
    sets: 3,
    repRangeMin: 8,
    repRangeMax: 12,
    currentWeight: 40,
    increment: 5,
    ...(order !== undefined ? { order } : {}),
  };
}

describe('accessoryRepo', () => {
  beforeEach(async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
  });

  it('enforces max 3 active accessories per day', async () => {
    await addAccessory(newAcc('A'));
    await addAccessory(newAcc('B'));
    await addAccessory(newAcc('C'));
    await expect(addAccessory(newAcc('D'))).rejects.toThrow();
    expect(await listActiveAccessories('bench')).toHaveLength(MAX_ACTIVE_ACCESSORIES_PER_DAY);
  });

  it('archiving frees a slot so a new one can be added', async () => {
    const a = await addAccessory(newAcc('A'));
    await addAccessory(newAcc('B'));
    await addAccessory(newAcc('C'));
    await archiveAccessory(a.id);
    // Now only 2 active → room for one more.
    await addAccessory(newAcc('D'));
    const active = await listActiveAccessories('bench');
    expect(active.map((x) => x.name).sort()).toEqual(['B', 'C', 'D']);
  });

  it('update patches editable fields only', async () => {
    const a = await addAccessory(newAcc('A'));
    await updateAccessory(a.id, { name: 'A2', currentWeight: 55 });
    const active = await listActiveAccessories('bench');
    expect(active[0]!.name).toBe('A2');
    expect(active[0]!.currentWeight).toBe(55);
  });

  it('unarchive restores a slot but enforces the max-3 cap transactionally (finding 12)', async () => {
    const a = await addAccessory(newAcc('A'));
    await addAccessory(newAcc('B'));
    await addAccessory(newAcc('C'));
    // Archive one, leaving 2 active + 1 archived → restore is allowed.
    await archiveAccessory(a.id);
    await unarchiveAccessory(a.id);
    expect((await listActiveAccessories('bench')).map((x) => x.name).sort()).toEqual(['A', 'B', 'C']);

    // Now archive A again and add a 3rd active (D) so the day is full with A archived.
    await archiveAccessory(a.id);
    await addAccessory(newAcc('D'));
    expect(await listActiveAccessories('bench')).toHaveLength(3);
    // Restoring A would make 4 active → must throw at the cap.
    await expect(unarchiveAccessory(a.id)).rejects.toThrow();
    expect(await listActiveAccessories('bench')).toHaveLength(3);
  });

  it('reorder assigns sequential order by the given id list', async () => {
    const a = await addAccessory(newAcc('A'));
    const b = await addAccessory(newAcc('B'));
    const c = await addAccessory(newAcc('C'));
    await reorderAccessories('bench', [c.id, a.id, b.id]);
    const active = await listActiveAccessories('bench');
    expect(active.map((x) => x.name)).toEqual(['C', 'A', 'B']);
    expect(active.map((x) => x.order)).toEqual([0, 1, 2]);
  });
});

describe('deload add / remove on the active cycle', () => {
  it('adds a deload week to a no-deload cycle and can remove it while pending', async () => {
    await initializeFromOnboarding(lbOnboardingPayload({ includeDeload: false }));
    let cycle = await getActiveCycle();
    expect(await getCycleWorkouts(cycle!.id)).toHaveLength(12);

    await addDeloadToActiveCycle();
    cycle = await getActiveCycle();
    expect(cycle!.includeDeload).toBe(true);
    let workouts = await getCycleWorkouts(cycle!.id);
    expect(workouts).toHaveLength(16);
    expect(workouts.filter((w) => w.week === 4)).toHaveLength(4);

    await removeDeloadFromActiveCycle();
    cycle = await getActiveCycle();
    expect(cycle!.includeDeload).toBe(false);
    workouts = await getCycleWorkouts(cycle!.id);
    expect(workouts).toHaveLength(12);
    expect(workouts.filter((w) => w.week === 4)).toHaveLength(0);
  });

  it('refuses to remove a deload week once one of its workouts has started', async () => {
    await initializeFromOnboarding(lbOnboardingPayload({ includeDeload: true }));
    const cycle = await getActiveCycle();
    const wk4 = (await getCycleWorkouts(cycle!.id)).find((w) => w.week === 4)!;
    await startWorkout(wk4.id);
    await expect(removeDeloadFromActiveCycle()).rejects.toThrow();
  });
});
