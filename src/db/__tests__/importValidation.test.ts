import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, lbOnboardingPayload } from './setup.ts';
import { initializeFromOnboarding } from '../repo/onboardingRepo.ts';
import { addStretchSession, listStretchSessions } from '../repo/stretchRepo.ts';
import { seedDemoData } from '../devSeed.ts';
import {
  exportBackup,
  importBackup,
  parseBackupJson,
  stretchImportPlan,
  validateBackup,
  BackupValidationError,
} from '../exportImport.ts';
import { db } from '../db.ts';
import type { BackupFile } from '../../core/types.ts';

beforeEach(resetDb);

async function snapshotAllTables() {
  const sortById = <T extends { id?: string; liftId?: string }>(rows: T[]) =>
    [...rows].sort((a, b) => String(a.id ?? a.liftId).localeCompare(String(b.id ?? b.liftId)));
  return {
    settings: sortById(await db.settings.toArray()),
    liftState: sortById(await db.liftState.toArray()),
    cycles: sortById(await db.cycles.toArray()),
    workouts: sortById(await db.workouts.toArray()),
    accessories: sortById(await db.accessories.toArray()),
    bodyweight: sortById(await db.bodyweight.toArray()),
    tmEvents: sortById(await db.tmEvents.toArray()),
    stretchSessions: sortById(await db.stretchSessions.toArray()),
    savedRoutines: sortById(await db.savedRoutines.toArray()),
  };
}

function stretch(date: string) {
  const startedAt = Date.parse(`${date}T08:00:00`);
  return {
    date,
    startedAt,
    completedAt: startedAt + 6 * 60_000,
    plannedSec: 360,
    actualSec: 350,
    minutes: 6,
    focusAreas: ['hips' as const],
    stretchIds: ['cat-cow', 'pigeon'],
  };
}

/** A real, rich export: three seeded cycles of training plus stretch sessions. */
async function seededBackup(): Promise<BackupFile> {
  await seedDemoData(3);
  await addStretchSession(stretch('2026-07-04'));
  await addStretchSession(stretch('2026-07-05'));
  return exportBackup();
}

/** Expect a rejected import that names `pattern`, then prove the DB is untouched. */
async function expectRejectedUnchanged(file: unknown, pattern: RegExp) {
  const before = await snapshotAllTables();
  await expect(importBackup(file as BackupFile)).rejects.toSatisfy(
    (err: unknown) => err instanceof BackupValidationError && pattern.test(err.message),
  );
  expect(await snapshotAllTables()).toEqual(before);
}

describe('import: dev-seeded round trip', () => {
  it('a dev-seeded export (3 cycles + stretch) re-imports cleanly and deep-equal', async () => {
    const backup = await seededBackup();
    const before = await snapshotAllTables();
    expect(before.workouts.length).toBeGreaterThan(20);

    const parsed = parseBackupJson(JSON.stringify(backup));
    await resetDb();
    await importBackup(parsed);
    expect(await snapshotAllTables()).toEqual(before);
  });

  it('an export with NO optional fields populated also validates (fresh onboarding)', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const backup = await exportBackup();
    expect(() => validateBackup(JSON.parse(JSON.stringify(backup)))).not.toThrow();
  });

  it('an entirely empty backup (no settings, nothing else) is accepted', () => {
    const empty = {
      app: 'five31',
      schemaVersion: 2,
      exportedAt: '2026-07-05T00:00:00.000Z',
      data: {
        settings: [],
        liftState: [],
        cycles: [],
        workouts: [],
        accessories: [],
        bodyweight: [],
        tmEvents: [],
        stretchSessions: [],
      },
    };
    expect(() => validateBackup(empty)).not.toThrow();
  });
});

describe('import: stretch history vs. backup version', () => {
  it('a v1 backup KEEPS the existing stretch log', async () => {
    const backup = await seededBackup();
    const v1 = structuredClone(backup);
    v1.schemaVersion = 1;
    delete v1.data.stretchSessions;
    delete v1.data.savedRoutines;
    expect(stretchImportPlan(v1)).toEqual({ mode: 'kept' });

    const stretchBefore = await listStretchSessions();
    await db.stretchSessions.add({ ...stretch('2026-07-06'), id: 'later-session' });
    const keep = await listStretchSessions();
    expect(keep).toHaveLength(stretchBefore.length + 1);

    await importBackup(parseBackupJson(JSON.stringify(v1)));
    expect(await listStretchSessions()).toEqual(keep);
  });

  it('a v1 backup that (oddly) carries a stretchSessions array still keeps the live log', async () => {
    const backup = await seededBackup();
    const v1 = structuredClone(backup);
    v1.schemaVersion = 1;
    v1.data.stretchSessions = [];
    delete v1.data.savedRoutines;
    const keep = await listStretchSessions();
    await importBackup(v1);
    expect(await listStretchSessions()).toEqual(keep);
  });

  it('a v2 backup REPLACES the stretch log with its own sessions', async () => {
    const backup = await seededBackup();
    expect(stretchImportPlan(backup)).toEqual({ mode: 'replaced', count: 2 });
    await db.stretchSessions.add({ ...stretch('2026-07-06'), id: 'later-session' });
    expect(await db.stretchSessions.count()).toBe(3);

    await importBackup(backup);
    expect((await listStretchSessions()).map((s) => s.id)).toEqual(
      backup.data.stretchSessions!.map((s) => s.id),
    );
  });

  it('a v2 backup with zero sessions replaces the log with nothing', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const backup = await exportBackup();
    expect(stretchImportPlan(backup)).toEqual({ mode: 'replaced', count: 0 });
    await addStretchSession(stretch('2026-07-06'));
    await importBackup(backup);
    expect(await db.stretchSessions.count()).toBe(0);
  });
});

describe('import validation: header', () => {
  it.each([
    ['NaN', Number.NaN],
    ['0', 0],
    ['1.5', 1.5],
    ['-1', -1],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a string', '2'],
  ])('rejects schemaVersion %s with a BackupValidationError', async (_label, version) => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const backup = structuredClone(await exportBackup()) as unknown as Record<string, unknown>;
    backup.schemaVersion = version;
    expect(() => validateBackup(backup)).toThrow(BackupValidationError);
    await expectRejectedUnchanged(backup, /schemaVersion/);
  });

  it('rejects data in other tables with an empty settings array (onboarding dead end)', async () => {
    const backup = structuredClone(await seededBackup());
    backup.data.settings = [];
    await expectRejectedUnchanged(backup, /no settings row/);
  });

  it('rejects more than one settings row', async () => {
    const backup = structuredClone(await seededBackup());
    backup.data.settings = [backup.data.settings[0]!, { ...backup.data.settings[0]! }];
    // Two rows necessarily share the fixed 'singleton' id, so the duplicate-key
    // check catches it first; a distinct id is rejected by the id rule instead.
    await expectRejectedUnchanged(backup, /'settings' row 1 repeats id/);
  });

  it('rejects stretch-only data with no settings row', () => {
    const file = {
      app: 'five31',
      schemaVersion: 2,
      exportedAt: '2026-07-05T00:00:00.000Z',
      data: {
        settings: [],
        liftState: [],
        cycles: [],
        workouts: [],
        accessories: [],
        bodyweight: [],
        tmEvents: [],
        stretchSessions: [{ ...stretch('2026-07-05'), id: 's1' }],
      },
    };
    expect(() => validateBackup(file)).toThrow(/no settings row/);
  });
});

describe('import validation: rows (rejected before any DB mutation)', () => {
  type Mutator = (b: BackupFile) => void;
  const cases: [string, Mutator, RegExp][] = [
    [
      'workouts.mainSets not an array',
      (b) => {
        (b.data.workouts[3] as unknown as Record<string, unknown>).mainSets = 'oops';
      },
      /'workouts' row 3 field 'mainSets' must be an array/,
    ],
    [
      'workouts.accessoryWork missing',
      (b) => {
        delete (b.data.workouts[0] as unknown as Record<string, unknown>).accessoryWork;
      },
      /'workouts' row 0 is missing 'accessoryWork'/,
    ],
    [
      'a main set with a string weight',
      (b) => {
        (b.data.workouts[1]!.mainSets[0] as unknown as Record<string, unknown>).weight = '135';
      },
      /'workouts' row 1 field 'mainSets' \[0\] field 'weight'/,
    ],
    [
      'an empty workout id',
      (b) => {
        b.data.workouts[2]!.id = '';
      },
      /'workouts' row 2 field 'id' must be a non-empty string/,
    ],
    [
      'an unknown workout status',
      (b) => {
        (b.data.workouts[0] as unknown as Record<string, unknown>).status = 'done';
      },
      /'workouts' row 0 field 'status'/,
    ],
    [
      'a cycle with a bogus status',
      (b) => {
        (b.data.cycles[0] as unknown as Record<string, unknown>).status = 'paused';
      },
      /'cycles' row 0 field 'status'/,
    ],
    [
      'a cycle whose tms lack a lift',
      (b) => {
        delete (b.data.cycles[1]!.tms as Partial<Record<string, number>>).squat;
      },
      /'cycles' row 1 field 'tms' \.squat/,
    ],
    [
      'two active cycles',
      (b) => {
        for (const c of b.data.cycles) c.status = 'active';
      },
      /more than one active cycle/,
    ],
    [
      'a liftState trainingMax as a string',
      (b) => {
        (b.data.liftState[0] as unknown as Record<string, unknown>).trainingMax = '300';
      },
      /'liftState' row 0 field 'trainingMax'/,
    ],
    [
      'a tmEvent with a numeric cycleId',
      (b) => {
        (b.data.tmEvents[0] as unknown as Record<string, unknown>).cycleId = 7;
      },
      /'tmEvents' row 0 field 'cycleId'/,
    ],
    [
      'an accessory with no name',
      (b) => {
        delete (b.data.accessories[0] as unknown as Record<string, unknown>).name;
      },
      /'accessories' row 0 is missing 'name'/,
    ],
    [
      'a bodyweight row that is not an object',
      (b) => {
        (b.data.bodyweight as unknown[])[0] = 185;
      },
      /'bodyweight' row 0 is not an object/,
    ],
    [
      'a stretch session whose stretchIds is not an array',
      (b) => {
        (b.data.stretchSessions![1] as unknown as Record<string, unknown>).stretchIds = 'cat-cow';
      },
      /'stretchSessions' row 1 field 'stretchIds' must be an array/,
    ],
    [
      'a stretch session whose focusAreas is missing',
      (b) => {
        delete (b.data.stretchSessions![0] as unknown as Record<string, unknown>).focusAreas;
      },
      /'stretchSessions' row 0 is missing 'focusAreas'/,
    ],
    [
      'a settings row with a foreign id',
      (b) => {
        (b.data.settings[0] as unknown as Record<string, unknown>).id = 'main';
      },
      /'settings' row 0 field 'id'/,
    ],
    [
      'a settings row with liftIncrements missing',
      (b) => {
        delete (b.data.settings[0] as unknown as Record<string, unknown>).liftIncrements;
      },
      /'settings' row 0 is missing 'liftIncrements'/,
    ],
    [
      'a present-but-wrong optional field (notes as a number)',
      (b) => {
        (b.data.workouts[0] as unknown as Record<string, unknown>).notes = 42;
      },
      /'workouts' row 0 field 'notes'/,
    ],
    [
      'a duplicate workout id',
      (b) => {
        b.data.workouts[1]!.id = b.data.workouts[0]!.id;
      },
      /'workouts' row 1 repeats id/,
    ],
  ];

  it.each(cases)('rejects %s, naming table and row, DB unchanged', async (_label, mutate, pattern) => {
    const backup = structuredClone(await seededBackup());
    mutate(backup);
    await expectRejectedUnchanged(backup, pattern);
    // The JSON path (what the Settings screen uses) rejects too.
    expect(() => parseBackupJson(JSON.stringify(backup))).toThrow(BackupValidationError);
  });

  it('a StrongLifts cycle with no sl runtime is rejected', async () => {
    const backup = structuredClone(await seededBackup());
    backup.data.cycles[0]!.program = 'sl5x5';
    await expectRejectedUnchanged(backup, /StrongLifts cycle with no 'sl' runtime/);
  });

  it('an accessory set rep of null (an unlogged set) is valid', async () => {
    const backup = structuredClone(await seededBackup());
    const withAcc = backup.data.workouts.find((w) => w.accessoryWork.length > 0)!;
    withAcc.accessoryWork[0]!.setReps[0] = null;
    expect(() => validateBackup(backup)).not.toThrow();
  });
});
