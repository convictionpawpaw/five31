import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, lbOnboardingPayload } from './setup.ts';
// After setup.ts, which installs fake-indexeddb before Dexie loads.
import Dexie from 'dexie';
import { initializeFromOnboarding } from '../repo/onboardingRepo.ts';
import {
  ROUTINE_NAME_MAX,
  RoutineNameError,
  addSavedRoutine,
  addStretchSession,
  deleteSavedRoutine,
  listSavedRoutines,
  listStretchSessions,
  renameSavedRoutine,
} from '../repo/index.ts';
import {
  BackupValidationError,
  exportBackup,
  importBackup,
  parseBackupJson,
  savedRoutinesImportPlan,
} from '../exportImport.ts';
import { CURRENT_SCHEMA_VERSION, migrateBackup } from '../migrations.ts';
import { db } from '../db.ts';
import { generateRoutine } from '../../core/stretch/generator.ts';
import type { BackupFile } from '../../core/types.ts';

beforeEach(resetDb);

const routine = (seed = 1) =>
  generateRoutine({ minutes: 7, focusAreas: ['neck', 'upperBack', 'lowerBack', 'chest'], seed });

function session(date: string) {
  const startedAt = Date.parse(`${date}T08:00:00`);
  return {
    date,
    startedAt,
    completedAt: startedAt + 7 * 60_000,
    plannedSec: 420,
    actualSec: 410,
    minutes: 7,
    focusAreas: ['neck' as const],
    stretchIds: ['chin-tuck'],
  };
}

async function snapshot() {
  const byId = <T extends { id?: string; liftId?: string }>(rows: T[]) =>
    [...rows].sort((a, b) => String(a.id ?? a.liftId).localeCompare(String(b.id ?? b.liftId)));
  return {
    settings: byId(await db.settings.toArray()),
    liftState: byId(await db.liftState.toArray()),
    cycles: byId(await db.cycles.toArray()),
    workouts: byId(await db.workouts.toArray()),
    accessories: byId(await db.accessories.toArray()),
    bodyweight: byId(await db.bodyweight.toArray()),
    tmEvents: byId(await db.tmEvents.toArray()),
    stretchSessions: byId(await db.stretchSessions.toArray()),
    savedRoutines: byId(await db.savedRoutines.toArray()),
  };
}

describe('saved routines repo', () => {
  it('adds a full snapshot under a trimmed name and lists newest first', async () => {
    const r1 = routine(1);
    const a = await addSavedRoutine('  Morning  ', r1, 1000);
    const b = await addSavedRoutine('Evening', routine(2), 2000);
    expect(a.name).toBe('Morning');
    expect(a.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(a.createdAt).toBe(1000);
    expect(a.updatedAt).toBe(1000);
    expect(a.routine).toEqual(r1);
    expect(a.routine).not.toBe(r1); // stored as a copy
    expect((await listSavedRoutines()).map((x) => x.id)).toEqual([b.id, a.id]);
  });

  it('allows duplicate names', async () => {
    await addSavedRoutine('Same', routine(1));
    await addSavedRoutine('Same', routine(2));
    expect((await listSavedRoutines()).map((x) => x.name)).toEqual(['Same', 'Same']);
  });

  it('rejects empty and over-long names (after trimming), writing nothing', async () => {
    await expect(addSavedRoutine('   ', routine())).rejects.toBeInstanceOf(RoutineNameError);
    await expect(
      addSavedRoutine('x'.repeat(ROUTINE_NAME_MAX + 1), routine()),
    ).rejects.toBeInstanceOf(RoutineNameError);
    const ok = await addSavedRoutine(` ${'x'.repeat(ROUTINE_NAME_MAX)} `, routine());
    expect(ok.name).toHaveLength(ROUTINE_NAME_MAX);
    expect(await db.savedRoutines.count()).toBe(1);
  });

  it('renames (trimmed, bumps updatedAt) and rejects a bad name or a missing routine', async () => {
    const a = await addSavedRoutine('Old', routine(), 1000);
    await renameSavedRoutine(a.id, '  New name ', 5000);
    const got = await db.savedRoutines.get(a.id);
    expect(got).toMatchObject({ name: 'New name', createdAt: 1000, updatedAt: 5000 });
    expect(got!.routine).toEqual(a.routine);
    await expect(renameSavedRoutine(a.id, '')).rejects.toBeInstanceOf(RoutineNameError);
    await expect(renameSavedRoutine('nope', 'X')).rejects.toThrow(/no longer exists/);
    // Renaming to the same name is fine.
    await expect(renameSavedRoutine(a.id, 'New name', 6000)).resolves.toBeUndefined();
  });

  it('deletes one routine and leaves the rest', async () => {
    const a = await addSavedRoutine('A', routine(1));
    const b = await addSavedRoutine('B', routine(2));
    await deleteSavedRoutine(a.id);
    await deleteSavedRoutine(a.id); // already gone: no-op
    expect((await listSavedRoutines()).map((x) => x.id)).toEqual([b.id]);
  });
});

describe('backup schema v3: saved routines', () => {
  it('exports savedRoutines at schemaVersion 3 and round-trips them exactly', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    await addSavedRoutine('A', routine(1));
    await addSavedRoutine('B', generateRoutine({ minutes: 5, focusAreas: [], seed: 4, reps: 3 }));
    const backup = await exportBackup();
    expect(CURRENT_SCHEMA_VERSION).toBe(3);
    expect(backup.schemaVersion).toBe(3);
    expect(backup.data.savedRoutines).toHaveLength(2);
    expect(savedRoutinesImportPlan(backup)).toEqual({ mode: 'replaced', count: 2 });

    const before = await snapshot();
    const parsed = parseBackupJson(JSON.stringify(backup));
    await resetDb();
    await importBackup(parsed);
    expect(await snapshot()).toEqual(before);
  });

  it('a v3 import REPLACES saved routines', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const kept = await addSavedRoutine('In backup', routine(1));
    const backup = await exportBackup();
    await addSavedRoutine('Added later', routine(2));
    await importBackup(backup);
    expect((await listSavedRoutines()).map((x) => x.id)).toEqual([kept.id]);
  });

  it('a v2 backup still imports and KEEPS the saved routines on this device', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    await addStretchSession(session('2026-07-04'));
    const v2 = structuredClone(await exportBackup()) as BackupFile;
    v2.schemaVersion = 2;
    delete v2.data.savedRoutines;
    expect(savedRoutinesImportPlan(v2)).toEqual({ mode: 'kept' });

    await addSavedRoutine('Mine', routine(1));
    const keep = await listSavedRoutines();
    await addStretchSession(session('2026-07-05'));
    await importBackup(parseBackupJson(JSON.stringify(v2)));
    expect(await listSavedRoutines()).toEqual(keep);
    // v2 still replaces the stretch log as before.
    expect((await listStretchSessions()).map((s) => s.date)).toEqual(['2026-07-04']);
  });

  it('a v1 backup still imports and keeps both stretch history and saved routines', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const v1 = structuredClone(await exportBackup()) as BackupFile;
    v1.schemaVersion = 1;
    delete v1.data.stretchSessions;
    delete v1.data.savedRoutines;
    await addSavedRoutine('Mine', routine(1));
    await addStretchSession(session('2026-07-05'));
    const routines = await listSavedRoutines();
    const sessions = await listStretchSessions();
    await importBackup(parseBackupJson(JSON.stringify(v1)));
    expect(await listSavedRoutines()).toEqual(routines);
    expect(await listStretchSessions()).toEqual(sessions);
  });

  it('a v2 file that (oddly) carries savedRoutines still keeps the live ones', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const v2 = structuredClone(await exportBackup()) as BackupFile;
    v2.schemaVersion = 2;
    v2.data.savedRoutines = [];
    await addSavedRoutine('Mine', routine(1));
    const keep = await listSavedRoutines();
    await importBackup(v2);
    expect(await listSavedRoutines()).toEqual(keep);
  });

  it('migrates a v2 payload by adding an empty savedRoutines array', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const v2 = structuredClone(await exportBackup()) as BackupFile;
    delete v2.data.savedRoutines;
    const migrated = migrateBackup(v2.data, 2);
    expect(migrated.savedRoutines).toEqual([]);
    expect(migrated.workouts).toEqual(v2.data.workouts);
  });

  it('a v3 backup without the savedRoutines array is rejected', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const bad = structuredClone(await exportBackup()) as BackupFile;
    delete bad.data.savedRoutines;
    expect(() => parseBackupJson(JSON.stringify(bad))).toThrow(/savedRoutines/);
  });

  type Mutator = (row: Record<string, unknown>) => void;
  const bad: [string, Mutator, RegExp][] = [
    ['a numeric name', (r) => (r.name = 7), /field 'name' must be a string/],
    ['no routine', (r) => delete r.routine, /is missing 'routine'/],
    [
      'a routine that is not an object',
      (r) => (r.routine = 'x'),
      /field 'routine' is not an object/,
    ],
    [
      'steps not an array',
      (r) => ((r.routine as Record<string, unknown>).steps = {}),
      /field 'steps' must be an array/,
    ],
    [
      'a step without a stretchId',
      (r) => delete (r.routine as { steps: Record<string, unknown>[] }).steps[0]!.stretchId,
      /\[0\] is missing 'stretchId'/,
    ],
    [
      'a non-finite hold',
      (r) => ((r.routine as { steps: Record<string, unknown>[] }).steps[1]!.holdSec = null),
      /\[1\] field 'holdSec' must be a finite number/,
    ],
    [
      'a bad side',
      (r) => ((r.routine as { steps: Record<string, unknown>[] }).steps[0]!.side = 'up'),
      /field 'side'/,
    ],
    [
      'a string rep',
      (r) => ((r.routine as { steps: Record<string, unknown>[] }).steps[0]!.rep = '1'),
      /field 'rep' must be a finite number/,
    ],
    ['a missing createdAt', (r) => delete r.createdAt, /is missing 'createdAt'/],
  ];

  it.each(bad)('rejects a saved routine with %s, DB unchanged', async (_label, mutate, pattern) => {
    await initializeFromOnboarding(lbOnboardingPayload());
    await addSavedRoutine('A', routine(1));
    const backup = structuredClone(await exportBackup()) as BackupFile;
    mutate(backup.data.savedRoutines![0] as unknown as Record<string, unknown>);
    await addSavedRoutine('Live', routine(2));
    const before = await snapshot();
    await expect(importBackup(backup)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof BackupValidationError &&
        /'savedRoutines' row 0/.test(err.message) &&
        pattern.test(err.message),
    );
    expect(await snapshot()).toEqual(before);
    expect(() => parseBackupJson(JSON.stringify(backup))).toThrow(BackupValidationError);
  });

  it('rejects a duplicate saved-routine id', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    await addSavedRoutine('A', routine(1));
    await addSavedRoutine('B', routine(2));
    const backup = structuredClone(await exportBackup()) as BackupFile;
    backup.data.savedRoutines![1]!.id = backup.data.savedRoutines![0]!.id;
    expect(() => parseBackupJson(JSON.stringify(backup))).toThrow(
      /'savedRoutines' row 1 repeats id/,
    );
  });
});

describe('IndexedDB upgrade v2 -> v3', () => {
  it('an existing v2 database with data opens under v3 with every row intact', async () => {
    db.close();
    await Dexie.delete('five31');
    const old = new Dexie('five31');
    old.version(1).stores({
      settings: 'id',
      liftState: 'liftId',
      cycles: 'id, number, status',
      workouts: 'id, cycleId, status, liftId, completedAt, [cycleId+week+liftId]',
      accessories: 'id, liftDayId',
      bodyweight: 'id, date',
      tmEvents: 'id, liftId, timestamp',
    });
    old.version(2).stores({ stretchSessions: 'id, date' });
    await old.open();
    const rows: Record<string, Record<string, unknown>[]> = {
      settings: [{ id: 'singleton', units: 'lb' }],
      liftState: [{ liftId: 'squat', trainingMax: 300 }],
      cycles: [{ id: 'c1', number: 1, status: 'active' }],
      workouts: [{ id: 'w1', cycleId: 'c1', status: 'pending', liftId: 'squat', week: 1 }],
      accessories: [{ id: 'a1', liftDayId: 'squat', name: 'Leg Curl' }],
      bodyweight: [{ id: 'bw1', date: '2026-07-01', weight: 180, units: 'lb' }],
      tmEvents: [{ id: 't1', liftId: 'squat', timestamp: '2026-07-01T00:00:00Z' }],
      stretchSessions: [{ id: 's1', date: '2026-07-05', stretchIds: ['chin-tuck'] }],
    };
    for (const [table, list] of Object.entries(rows)) await old.table(table).bulkAdd(list);
    old.close();

    await db.open();
    expect(db.verno).toBe(3);
    for (const [table, list] of Object.entries(rows)) {
      expect(await db.table(table).toArray(), table).toEqual(list);
    }
    expect(await db.savedRoutines.count()).toBe(0);
    const saved = await addSavedRoutine('After upgrade', routine(1));
    expect((await listSavedRoutines()).map((x) => x.id)).toEqual([saved.id]);
  });
});
