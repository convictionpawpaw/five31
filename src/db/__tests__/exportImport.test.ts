import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, lbOnboardingPayload } from './setup.ts';
import { initializeFromOnboarding } from '../repo/onboardingRepo.ts';
import { getActiveCycle, getCycleWorkouts } from '../repo/cycleRepo.ts';
import { startWorkout, logMainSet, finishWorkout } from '../repo/workoutRepo.ts';
import { upsertBodyweight } from '../repo/bodyweightRepo.ts';
import {
  exportBackup,
  importBackup,
  parseBackupJson,
  BackupValidationError,
} from '../exportImport.ts';
import { db } from '../db.ts';
import type { BackupFile } from '../../core/types.ts';

beforeEach(resetDb);

/** Read every table into a plain object for deep comparison. */
async function snapshotAllTables() {
  const [settings, liftState, cycles, workouts, accessories, bodyweight, tmEvents] =
    await Promise.all([
      db.settings.toArray(),
      db.liftState.toArray(),
      db.cycles.toArray(),
      db.workouts.toArray(),
      db.accessories.toArray(),
      db.bodyweight.toArray(),
      db.tmEvents.toArray(),
    ]);
  const sortById = <T extends { id?: string; liftId?: string }>(rows: T[]) =>
    [...rows].sort((a, b) => String(a.id ?? a.liftId).localeCompare(String(b.id ?? b.liftId)));
  return {
    settings: sortById(settings),
    liftState: sortById(liftState),
    cycles: sortById(cycles),
    workouts: sortById(workouts),
    accessories: sortById(accessories),
    bodyweight: sortById(bodyweight),
    tmEvents: sortById(tmEvents),
  };
}

async function seedRichState() {
  await initializeFromOnboarding(
    lbOnboardingPayload({
      accessories: [
        { liftDayId: 'bench', name: 'Dips', sets: 3, repRangeMin: 8, repRangeMax: 12, currentWeight: 40, increment: 5 },
      ],
    }),
  );
  const cycle = await getActiveCycle();
  const bench = (await getCycleWorkouts(cycle!.id)).find((w) => w.liftId === 'bench' && w.week === 1)!;
  await startWorkout(bench.id);
  await logMainSet(bench.id, 'work', 2, 9);
  await finishWorkout(bench.id);
  await upsertBodyweight('2026-07-05', 185, 'lb');
}

describe('export / import', () => {
  it('round-trips: export → clear → import → deep-equal across all tables', async () => {
    await seedRichState();
    const before = await snapshotAllTables();
    const backup = await exportBackup();

    // Serialize + reparse to prove the JSON is faithful.
    const json = JSON.stringify(backup);
    const parsed = parseBackupJson(json);

    await resetDb();
    expect((await snapshotAllTables()).settings).toHaveLength(0);

    await importBackup(parsed);
    const after = await snapshotAllTables();

    expect(after).toEqual(before);
  });

  it('export includes all 7 tables with the app + schemaVersion header', async () => {
    await seedRichState();
    const backup = await exportBackup();
    expect(backup.app).toBe('five31');
    expect(backup.schemaVersion).toBe(1);
    expect(Object.keys(backup.data).sort()).toEqual(
      ['accessories', 'bodyweight', 'cycles', 'liftState', 'settings', 'tmEvents', 'workouts'].sort(),
    );
    expect(backup.data.settings).toHaveLength(1);
    expect(backup.data.workouts.length).toBeGreaterThan(0);
  });

  it('rejects a non-FIVE31 file', async () => {
    const bad = { app: 'other', schemaVersion: 1, data: {} } as unknown as BackupFile;
    await expect(importBackup(bad)).rejects.toBeInstanceOf(BackupValidationError);
  });

  it('rejects a future schemaVersion', async () => {
    await seedRichState();
    const backup = await exportBackup();
    backup.schemaVersion = 99;
    await expect(importBackup(backup)).rejects.toBeInstanceOf(BackupValidationError);
  });

  it('parseBackupJson rejects syntactically-valid non-FIVE31 JSON (no summary crash)', async () => {
    // Regression (finding 4): the import summary reads data.cycles.length etc.
    // at render time, so parse MUST reject non-backup JSON up front rather than
    // returning an object with a missing/undefined `data`.
    expect(() => parseBackupJson('{}')).toThrow(BackupValidationError);
    expect(() => parseBackupJson('[]')).toThrow(BackupValidationError);
    expect(() => parseBackupJson('{"app":"five31","schemaVersion":1}')).toThrow(
      BackupValidationError,
    );
    expect(() =>
      parseBackupJson('{"app":"five31","schemaVersion":1,"data":{"cycles":[]}}'),
    ).toThrow(BackupValidationError);
    expect(() => parseBackupJson('not json')).toThrow(BackupValidationError);
  });

  it('parseBackupJson accepts a real exported backup and exposes readable arrays', async () => {
    await seedRichState();
    const json = JSON.stringify(await exportBackup());
    const parsed = parseBackupJson(json);
    // These reads are exactly what the import summary performs — must not throw.
    expect(Array.isArray(parsed.data.cycles)).toBe(true);
    expect(parsed.data.workouts.length).toBeGreaterThan(0);
  });

  it('import replaces (does not merge) existing data', async () => {
    await seedRichState();
    const backup = await exportBackup();
    const workoutCount = backup.data.workouts.length;

    // Mutate live DB, then import the old backup — the mutation must vanish.
    await upsertBodyweight('2099-01-01', 999, 'lb');
    expect(await db.bodyweight.count()).toBe(2);

    await importBackup(backup);
    expect(await db.bodyweight.count()).toBe(1); // only the backed-up entry
    expect(await db.workouts.count()).toBe(workoutCount);
  });
});
