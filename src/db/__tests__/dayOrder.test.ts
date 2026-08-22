import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, lbOnboardingPayload } from './setup.ts';
import { initializeFromOnboarding } from '../repo/onboardingRepo.ts';
import {
  addDeloadToActiveCycle,
  completeCycle,
  getActiveCycle,
  getCycleWorkouts,
} from '../repo/cycleRepo.ts';
import { getSettings, updateSettings } from '../repo/settingsRepo.ts';
import { exportBackup, importBackup } from '../exportImport.ts';
import { db } from '../db.ts';
import {
  makeWorkoutOrderComparator,
  selectNextWorkout,
} from '../../features/shared/workoutSelect.ts';
import type { LiftId, SlLiftId } from '../../core/types.ts';

beforeEach(resetDb);

const CUSTOM: LiftId[] = ['squat', 'bench', 'deadlift', 'press'];

const FINAL_TMS: Record<LiftId, number> = {
  press: 125,
  bench: 205,
  squat: 310,
  deadlift: 360,
};

/**
 * The within-week lift sequence for a given week, as the UI would DISPLAY it —
 * i.e. after sorting the persisted rows through the same comparator the screens
 * use. (Raw table reads are id-ordered, not generation-ordered; ordering is
 * derived at display time, which is the whole point of the feature.)
 */
async function weekOrder(cycleId: string, week: number, order?: LiftId[]): Promise<SlLiftId[]> {
  const ws = await getCycleWorkouts(cycleId);
  return [...ws]
    .sort(makeWorkoutOrderComparator(order))
    .filter((w) => w.week === week)
    .map((w) => w.liftId);
}

describe('training-day order (dayOrder)', () => {
  it('absent dayOrder ⇒ classic generation order (friend unaffected)', async () => {
    await initializeFromOnboarding(lbOnboardingPayload({ includeDeload: false }));
    const cycle = await getActiveCycle();
    expect(await weekOrder(cycle!.id, 1)).toEqual(['press', 'deadlift', 'bench', 'squat']);
    // The Settings row leaves dayOrder undefined (identical to older rows).
    const settings = await getSettings();
    expect(settings!.dayOrder).toBeUndefined();
  });

  it('onboarding with a custom dayOrder persists it and generates in that order', async () => {
    await initializeFromOnboarding(
      lbOnboardingPayload({ includeDeload: false, dayOrder: CUSTOM }),
    );
    const settings = await getSettings();
    expect(settings!.dayOrder).toEqual(CUSTOM);

    const cycle = await getActiveCycle();
    expect(await weekOrder(cycle!.id, 1, CUSTOM)).toEqual(CUSTOM);
    // Still a full 12-workout cycle.
    expect(await getCycleWorkouts(cycle!.id)).toHaveLength(12);
  });

  it('completeCycle propagates the order to the next cycle generation sequence', async () => {
    // Start classic, switch the preference mid-life, then advance.
    await initializeFromOnboarding(lbOnboardingPayload({ includeDeload: false }));
    await updateSettings({ dayOrder: CUSTOM });

    const c2 = await completeCycle(FINAL_TMS);
    expect(await weekOrder(c2.id, 1, CUSTOM)).toEqual(CUSTOM);

    // End-to-end: the real Today-hero selector, reading the persisted rows plus
    // the stored preference, surfaces SQUAT week-1 first (classic default would
    // have surfaced PRESS) — proving the new cycle honors the setting.
    const settings = await getSettings();
    const c2Workouts = await getCycleWorkouts(c2.id);
    const next = selectNextWorkout(c2Workouts, settings!.dayOrder);
    expect(next?.liftId).toBe('squat');
    expect(next?.week).toBe(1);

    // Weights still correct at the new TM (bench wk1 @ 205 → 135/155/175).
    const benchWk1 = c2Workouts.find((w) => w.liftId === 'bench' && w.week === 1)!;
    expect(benchWk1.mainSets.filter((s) => s.kind === 'work').map((s) => s.weight)).toEqual([
      135, 155, 175,
    ]);
  });

  it('addDeloadToActiveCycle generates the deload week in the user order', async () => {
    await initializeFromOnboarding(
      lbOnboardingPayload({ includeDeload: false, dayOrder: CUSTOM }),
    );
    await addDeloadToActiveCycle();
    const cycle = await getActiveCycle();
    expect(await weekOrder(cycle!.id, 4, CUSTOM)).toEqual(CUSTOM);
  });

  it('settings.dayOrder round-trips through exportBackup → importBackup', async () => {
    await initializeFromOnboarding(
      lbOnboardingPayload({ includeDeload: false, dayOrder: CUSTOM }),
    );
    const backup = await exportBackup();
    expect(backup.data.settings[0]!.dayOrder).toEqual(CUSTOM);

    await resetDb();
    expect(await db.settings.count()).toBe(0);

    await importBackup(backup);
    const restored = await getSettings();
    expect(restored!.dayOrder).toEqual(CUSTOM);
  });

  it('an old backup with no dayOrder imports cleanly and stays classic', async () => {
    await initializeFromOnboarding(lbOnboardingPayload({ includeDeload: false }));
    const backup = await exportBackup();
    // Simulate a pre-R2 export: strip the field entirely.
    delete backup.data.settings[0]!.dayOrder;

    await resetDb();
    await importBackup(backup);
    const restored = await getSettings();
    expect(restored!.dayOrder).toBeUndefined();
  });
});
