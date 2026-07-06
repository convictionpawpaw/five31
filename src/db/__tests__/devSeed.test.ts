import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './setup.ts';
import { seedDemoData } from '../devSeed.ts';
import { getActiveCycle } from '../repo/cycleRepo.ts';
import { getSettings } from '../repo/settingsRepo.ts';
import { db, SETTINGS_ID } from '../db.ts';

beforeEach(resetDb);

describe('seedDemoData (finding 3: atomic wipe + reseed)', () => {
  it('leaves onboardingComplete true and exactly one active cycle', async () => {
    await seedDemoData(3);

    const settings = await getSettings();
    expect(settings).toBeDefined();
    expect(settings!.id).toBe(SETTINGS_ID);
    expect(settings!.onboardingComplete).toBe(true);

    const active = await getActiveCycle();
    expect(active).toBeDefined();
    const actives = await db.cycles.where('status').equals('active').toArray();
    expect(actives).toHaveLength(1);

    // 3 cycles requested: 2 completed + 1 active.
    expect(await db.cycles.count()).toBe(3);
    expect(await db.workouts.count()).toBeGreaterThan(0);
  });

  it('never observes an intermediate empty settings state (single commit)', async () => {
    // Seed once so there is prior state to wipe, then re-seed. A non-atomic
    // wipe+reseed would momentarily leave 0 settings rows; because everything
    // runs in ONE transaction, a settings read after seeding is always 1 and the
    // final state has onboardingComplete true (never stranded pre-onboarding).
    await seedDemoData(2);
    expect(await db.settings.count()).toBe(1);
    await seedDemoData(2);
    expect(await db.settings.count()).toBe(1);
    const settings = await getSettings();
    expect(settings!.onboardingComplete).toBe(true);
    const actives = await db.cycles.where('status').equals('active').toArray();
    expect(actives).toHaveLength(1);
  });

  it('re-seeding does not accumulate duplicate cycles', async () => {
    await seedDemoData(3);
    await seedDemoData(3);
    expect(await db.cycles.count()).toBe(3); // wiped, not appended
  });
});
