import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, lbOnboardingPayload } from './setup.ts';
import { NEW_KEYS, playSession, seedSlBlock, sessionRow } from './slHelpers.ts';
import { initializeFromOnboarding } from '../repo/onboardingRepo.ts';
import { getActiveCycle, getCycleWorkouts } from '../repo/cycleRepo.ts';
import { getSettings } from '../repo/settingsRepo.ts';
import { startSlSession } from '../repo/slRepo.ts';
import { finishWorkout, logMainSet, startWorkout } from '../repo/workoutRepo.ts';
import { exportBackup, importBackup, parseBackupJson } from '../exportImport.ts';
import { CURRENT_SCHEMA_VERSION } from '../migrations.ts';
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

/**
 * A hand-written v1 backup carrying NONE of the R3 fields — no `program`, `sl`,
 * `session`, `slSlot`, `prResets` or `pendingProgramSwitch` anywhere. This is
 * literally what the friend's phone exports today; it must import unchanged and
 * keep behaving like a classic 5/3/1 cycle. Written out longhand on purpose: a
 * fixture built from the current builders would silently acquire new fields.
 */
const LEGACY_V1_BACKUP: BackupFile = {
  app: 'five31',
  schemaVersion: 1,
  exportedAt: '2026-06-01T12:00:00.000Z',
  data: {
    settings: [
      {
        id: 'singleton',
        units: 'lb',
        roundingIncrement: 5,
        tmPercent: 0.9,
        includeDeload: false,
        liftIncrements: { press: 5, bench: 5, squat: 10, deadlift: 10 },
        onboardingComplete: true,
        schemaVersion: 1,
      },
    ],
    liftState: [
      { liftId: 'press', trainingMax: 120 },
      { liftId: 'deadlift', trainingMax: 350 },
      { liftId: 'bench', trainingMax: 200 },
      { liftId: 'squat', trainingMax: 300 },
    ],
    cycles: [
      {
        id: 'legacy-cycle-1',
        number: 1,
        status: 'active',
        startedAt: '2026-06-01T12:00:00.000Z',
        tms: { press: 120, deadlift: 350, bench: 200, squat: 300 },
        includeDeload: false,
        units: 'lb',
      },
    ],
    workouts: [
      {
        id: 'legacy-workout-bench-w1',
        cycleId: 'legacy-cycle-1',
        cycleNumber: 1,
        week: 1,
        liftId: 'bench',
        status: 'pending',
        tmUsed: 200,
        mainSets: [
          { kind: 'warmup', index: 0, percent: 0.4, weight: 80, targetReps: 5, amrap: false },
          { kind: 'work', index: 0, percent: 0.65, weight: 130, targetReps: 5, amrap: false },
          { kind: 'work', index: 1, percent: 0.75, weight: 150, targetReps: 5, amrap: false },
          { kind: 'work', index: 2, percent: 0.85, weight: 170, targetReps: 5, amrap: true },
        ],
        accessoryWork: [],
        units: 'lb',
      },
    ],
    accessories: [],
    bodyweight: [],
    tmEvents: [
      {
        id: 'legacy-event-1',
        liftId: 'bench',
        cycleId: 'legacy-cycle-1',
        timestamp: '2026-06-01T12:00:00.000Z',
        type: 'initial',
        fromValue: null,
        toValue: 200,
      },
    ],
  },
};

describe('export / import with StrongLifts data', () => {
  it('round-trips a block (cycle runtime, stamped rows, prResets) deep-equal', async () => {
    const block = await seedSlBlock({ keepPrs: false }); // writes a PR-reset marker
    await playSession(block.id, 1, { squat: 4 }); // completed rows + a fail streak
    await startSlSession(block.id, 2); // an in_progress, stamped session

    const before = await snapshotAllTables();
    const parsed = parseBackupJson(JSON.stringify(await exportBackup()));

    await resetDb();
    expect((await snapshotAllTables()).cycles).toHaveLength(0);

    await importBackup(parsed);
    expect(await snapshotAllTables()).toEqual(before);

    // Spot-check the SL-specific payload survived verbatim.
    const active = await getActiveCycle();
    expect(active!.program).toBe('sl5x5');
    expect(active!.sl!.lifts.squat).toEqual({ weight: 255, increment: 5, failStreak: 1 });
    expect(active!.sl!.keepPrs).toBe(false);
    expect((await getSettings())!.prResets).toHaveLength(1);
    const squatS2 = await sessionRow(active!.id, 2, 'squat');
    expect(squatS2.slSlot).toBe('B');
    expect(squatS2.session).toBe(2);
    expect(squatS2.mainSets).toHaveLength(5);
  });

  // StrongLifts itself needed NO migration; the version is past 1 only because the
  // Stretch feature added the stretchSessions and savedRoutines tables.
  it('stamps the current schemaVersion with no StrongLifts-specific tables', async () => {
    const block = await seedSlBlock();
    await playSession(block.id, 1);
    const backup = await exportBackup();
    expect(backup.app).toBe('five31');
    expect(backup.schemaVersion).toBe(3);
    expect(Object.keys(backup.data).sort()).toEqual(
      [
        'accessories',
        'bodyweight',
        'cycles',
        'liftState',
        'savedRoutines',
        'settings',
        'stretchSessions',
        'tmEvents',
        'workouts',
      ].sort(),
    );
    // The closed 5/3/1 cycle's 12 rows plus the block's 36 — both shapes coexist
    // in one v1 export, which is the whole no-migration claim.
    expect(backup.data.workouts).toHaveLength(48);
    expect(backup.data.workouts.filter((w) => w.program === 'sl5x5')).toHaveLength(36);
    expect(backup.data.workouts.filter((w) => w.program === undefined)).toHaveLength(12);
    expect(backup.data.cycles).toHaveLength(2);
  });

  it('a hand-written v1 backup with none of the new fields imports clean', async () => {
    await importBackup(structuredClone(LEGACY_V1_BACKUP));

    const cycle = await getActiveCycle();
    expect(cycle!.id).toBe('legacy-cycle-1');
    for (const key of NEW_KEYS) {
      expect(Object.keys(cycle!)).not.toContain(key);
      expect(Object.keys((await getSettings())!)).not.toContain(key);
    }
    const workouts = await getCycleWorkouts('legacy-cycle-1');
    expect(workouts).toHaveLength(1);
    for (const key of NEW_KEYS) expect(Object.keys(workouts[0]!)).not.toContain(key);
  });

  it('an imported legacy cycle still behaves CLASSIC (auto-start, accessories, finish)', async () => {
    await importBackup(structuredClone(LEGACY_V1_BACKUP));
    const id = 'legacy-workout-bench-w1';

    // The 5/3/1 auto-start affordance still fires — the SL guard is program-scoped.
    await logMainSet(id, 'work', 2, 8);
    let w = (await db.workouts.get(id))!;
    expect(w.status).toBe('in_progress');
    expect(w.startedAt).toBeDefined();
    expect(w.mainSets.find((s) => s.amrap)!.actualReps).toBe(8);

    await finishWorkout(id);
    w = (await db.workouts.get(id))!;
    expect(w.status).toBe('completed');
    for (const key of NEW_KEYS) expect(Object.keys(w)).not.toContain(key);
  });

  it('re-exports a legacy import byte-for-byte identically', async () => {
    await importBackup(structuredClone(LEGACY_V1_BACKUP));
    const re = await exportBackup();
    expect(re.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(re.data.settings).toEqual(LEGACY_V1_BACKUP.data.settings);
    expect(re.data.cycles).toEqual(LEGACY_V1_BACKUP.data.cycles);
    expect(re.data.workouts).toEqual(LEGACY_V1_BACKUP.data.workouts);
  });
});

describe('friend-path pins: a classic 5/3/1 install grows NO new keys', () => {
  it('a fresh Settings row carries none of the R3 fields', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const keys = Object.keys((await getSettings())!);
    for (const key of NEW_KEYS) expect(keys).not.toContain(key);
    expect(keys.sort()).toEqual(
      [
        'id',
        'units',
        'roundingIncrement',
        'tmPercent',
        'includeDeload',
        'liftIncrements',
        'onboardingComplete',
        'schemaVersion',
      ].sort(),
    );
  });

  it('a fresh Cycle carries none of the R3 fields', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const keys = Object.keys((await getActiveCycle())!);
    for (const key of NEW_KEYS) expect(keys).not.toContain(key);
  });

  it('fresh Workout rows carry none of the R3 fields, before and after training', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const cycle = await getActiveCycle();
    const rows = await getCycleWorkouts(cycle!.id);
    for (const w of rows) {
      for (const key of NEW_KEYS) expect(Object.keys(w)).not.toContain(key);
    }

    const bench = rows.find((w) => w.liftId === 'bench' && w.week === 1)!;
    await startWorkout(bench.id);
    await logMainSet(bench.id, 'work', 2, 9);
    await finishWorkout(bench.id);
    const after = (await db.workouts.get(bench.id))!;
    for (const key of NEW_KEYS) expect(Object.keys(after)).not.toContain(key);
  });

  it('a classic export contains the new keys NOWHERE in its JSON', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const json = JSON.stringify(await exportBackup());
    for (const key of NEW_KEYS) expect(json).not.toContain(`"${key}"`);
  });
});
