import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, lbOnboardingPayload } from './setup.ts';
// After setup.ts, which installs fake-indexeddb before Dexie loads.
import Dexie from 'dexie';
import { initializeFromOnboarding } from '../repo/onboardingRepo.ts';
import {
  addStretchSession,
  listStretchDays,
  listStretchSessions,
  recentStretchIds,
  type NewStretchSession,
} from '../repo/stretchRepo.ts';
import {
  exportBackup,
  importBackup,
  parseBackupJson,
  BackupValidationError,
} from '../exportImport.ts';
import { CURRENT_SCHEMA_VERSION, migrateBackup } from '../migrations.ts';
import { db } from '../db.ts';
import type { BackupFile } from '../../core/types.ts';

beforeEach(resetDb);

function session(date: string, stretchIds: string[], startedAt = Date.parse(`${date}T08:00:00`)) {
  return {
    date,
    startedAt,
    completedAt: startedAt + 7 * 60_000,
    plannedSec: 420,
    actualSec: 410,
    minutes: 7,
    focusAreas: ['neck', 'chest'],
    stretchIds,
  } satisfies NewStretchSession;
}

describe('stretchRepo', () => {
  it('adds sessions with a ulid and lists them oldest first', async () => {
    await addStretchSession(session('2026-07-05', ['chin-tuck']));
    await addStretchSession(session('2026-07-03', ['cat-cow']));
    const rows = await listStretchSessions();
    expect(rows.map((r) => r.date)).toEqual(['2026-07-03', '2026-07-05']);
    expect(rows[0]!.id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it('lists distinct days once even with several sessions per day', async () => {
    await addStretchSession(session('2026-07-05', ['a']));
    await addStretchSession(session('2026-07-05', ['b'], Date.parse('2026-07-05T20:00:00')));
    await addStretchSession(session('2026-07-04', ['c']));
    expect(await listStretchDays()).toEqual(['2026-07-04', '2026-07-05']);
  });

  it('recentStretchIds returns ids from the latest sessions, newest first, deduped', async () => {
    await addStretchSession(session('2026-07-01', ['old']));
    await addStretchSession(session('2026-07-02', ['a', 'b']));
    await addStretchSession(session('2026-07-03', ['b', 'c']));
    expect(await recentStretchIds(2)).toEqual(['b', 'c', 'a']);
    expect(await recentStretchIds(1)).toEqual(['b', 'c']);
    expect(await recentStretchIds(10)).toContain('old');
  });
});

describe('backup schema v2+: stretch sessions', () => {
  it('exports the stretchSessions table at the current schema (3 since saved routines)', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    await addStretchSession(session('2026-07-05', ['chin-tuck', 'cat-cow']));
    const backup = await exportBackup();
    expect(CURRENT_SCHEMA_VERSION).toBe(3);
    expect(backup.schemaVersion).toBe(3);
    expect(backup.data.stretchSessions).toHaveLength(1);
  });

  it('round-trips stretch sessions through export -> JSON -> import', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    await addStretchSession(session('2026-07-04', ['chin-tuck']));
    await addStretchSession(session('2026-07-05', ['cat-cow', 'sphinx']));
    const before = await listStretchSessions();
    const parsed = parseBackupJson(JSON.stringify(await exportBackup()));

    await resetDb();
    await importBackup(parsed);
    expect(await listStretchSessions()).toEqual(before);
  });

  it('import replaces stretch sessions rather than merging', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    await addStretchSession(session('2026-07-04', ['chin-tuck']));
    const backup = await exportBackup();
    await addStretchSession(session('2026-07-05', ['cat-cow']));
    await importBackup(backup);
    expect((await listStretchSessions()).map((s) => s.date)).toEqual(['2026-07-04']);
  });

  it('a v1 backup (no stretchSessions) still validates and imports, KEEPING stretch data', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const v3 = await exportBackup();
    const v1 = structuredClone(v3) as BackupFile;
    v1.schemaVersion = 1;
    delete v1.data.stretchSessions;
    delete v1.data.savedRoutines;

    // A v1 file predates the stretch table, so it says nothing about it: the
    // live stretch log (and streak) must survive the restore.
    await addStretchSession(session('2026-07-05', ['chin-tuck']));
    const before = await listStretchSessions();
    const parsed = parseBackupJson(JSON.stringify(v1));
    await importBackup(parsed);
    expect(await listStretchSessions()).toEqual(before);
    expect(await db.settings.count()).toBe(1);
  });

  it('migrates a v1 payload by adding an empty stretchSessions array', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const v1 = structuredClone(await exportBackup()) as BackupFile;
    delete v1.data.stretchSessions;
    delete v1.data.savedRoutines;
    const migrated = migrateBackup(v1.data, 1);
    expect(migrated.stretchSessions).toEqual([]);
    expect(migrated.savedRoutines).toEqual([]);
    expect(migrated.workouts).toEqual(v1.data.workouts);
  });

  it('a v2 backup without the stretchSessions array is rejected', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const bad = structuredClone(await exportBackup()) as BackupFile;
    bad.schemaVersion = 2;
    delete bad.data.stretchSessions;
    expect(() => parseBackupJson(JSON.stringify(bad))).toThrow(BackupValidationError);
  });
});

describe('IndexedDB upgrade v1 -> current', () => {
  it('an existing v1 database opens under the current version with its data intact and the new tables empty', async () => {
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
    await old.open();
    await old.table('bodyweight').add({ id: 'bw1', date: '2026-07-01', weight: 180, units: 'lb' });
    old.close();

    await db.open();
    expect(db.verno).toBe(3);
    expect(await db.bodyweight.get('bw1')).toMatchObject({ weight: 180 });
    expect(await db.stretchSessions.count()).toBe(0);
    expect(await db.savedRoutines.count()).toBe(0);
    await addStretchSession(session('2026-07-05', ['chin-tuck']));
    expect(await listStretchDays()).toEqual(['2026-07-05']);
  });
});
