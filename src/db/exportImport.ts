import type { BackupFile } from '../core/types.ts';
import { db } from './db.ts';
import { CURRENT_SCHEMA_VERSION, migrateBackup, type BackupData } from './migrations.ts';

/** The `app` discriminator every FIVE31 backup carries. */
export const BACKUP_APP = 'five31' as const;

/** The first backup schemaVersion that carries the `stretchSessions` table. */
export const STRETCH_SESSIONS_SINCE = 2;

/** The first backup schemaVersion that carries the `savedRoutines` table. */
export const SAVED_ROUTINES_SINCE = 3;

/**
 * Serialize the entire database into a portable backup object (all 9 tables).
 * Pure read — no mutation.
 */
export async function exportBackup(): Promise<BackupFile> {
  const [
    settings,
    liftState,
    cycles,
    workouts,
    accessories,
    bodyweight,
    tmEvents,
    stretchSessions,
    savedRoutines,
  ] = await db.transaction('r', allTables(), async () => {
    return Promise.all([
      db.settings.toArray(),
      db.liftState.toArray(),
      db.cycles.toArray(),
      db.workouts.toArray(),
      db.accessories.toArray(),
      db.bodyweight.toArray(),
      db.tmEvents.toArray(),
      db.stretchSessions.toArray(),
      db.savedRoutines.toArray(),
    ]);
  });

  return {
    app: BACKUP_APP,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      settings,
      liftState,
      cycles,
      workouts,
      accessories,
      bodyweight,
      tmEvents,
      stretchSessions,
      savedRoutines,
    },
  };
}

/** Every table a backup covers, for transaction scopes. */
function allTables() {
  return [
    db.settings,
    db.liftState,
    db.cycles,
    db.workouts,
    db.accessories,
    db.bodyweight,
    db.tmEvents,
    db.stretchSessions,
    db.savedRoutines,
  ];
}

/** Thrown when an import file fails validation before any DB mutation. */
export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

/** The seven data arrays every FIVE31 backup carries (any schemaVersion). */
const BACKUP_TABLES = [
  'settings',
  'liftState',
  'cycles',
  'workouts',
  'accessories',
  'bodyweight',
  'tmEvents',
] as const;

/** Tables added in later schema versions: required only from that version on. */
const VERSIONED_TABLES = [
  { table: 'stretchSessions', since: STRETCH_SESSIONS_SINCE },
  { table: 'savedRoutines', since: SAVED_ROUTINES_SINCE },
] as const;

// ---------------------------------------------------------------------------
// Per-row structural validation
// ---------------------------------------------------------------------------
//
// A tiny declarative schema, derived from src/core/types.ts and
// src/core/stretch/types.ts. It checks STRUCTURE (required fields present with
// the right primitive type, arrays where arrays are required, enum fields
// holding a known value) so a malformed row can never reach IndexedDB and crash
// a screen later. It deliberately does NOT check domain rules (e.g. that a TM
// is plausible): a genuine backup must always pass. Optional fields stay
// optional (absent is fine; present must have the right type).

/** A field check: returns an error fragment, or null when the value is fine. */
type Check = (value: unknown) => string | null;

const LIFTS = ['press', 'deadlift', 'bench', 'squat'] as const;
const SL_LIFTS = ['squat', 'bench', 'row', 'press', 'deadlift'] as const;
const UNITS = ['lb', 'kg'] as const;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str: Check = (v) => (typeof v === 'string' ? null : 'must be a string');
const id: Check = (v) => (typeof v === 'string' && v.length > 0 ? null : 'must be a non-empty string');
const num: Check = (v) => (typeof v === 'number' && Number.isFinite(v) ? null : 'must be a finite number');
const bool: Check = (v) => (typeof v === 'boolean' ? null : 'must be a boolean');
const oneOf =
  (values: readonly (string | number)[]): Check =>
  (v) =>
    (values as readonly unknown[]).includes(v) ? null : `must be one of ${values.join('/')}`;
const nullable =
  (inner: Check): Check =>
  (v) =>
    v === null ? null : inner(v) && `${inner(v)} or null`;
const arrayOf =
  (inner: Check): Check =>
  (v) => {
    if (!Array.isArray(v)) return 'must be an array';
    for (let i = 0; i < v.length; i++) {
      const err = inner(v[i]);
      if (err) return `[${i}] ${err}`;
    }
    return null;
  };
/** An object with a numeric entry for every key in `keys`. */
const numberRecord =
  (keys: readonly string[]): Check =>
  (v) => {
    if (!isObj(v)) return 'must be an object';
    for (const k of keys) {
      const err = num(v[k]);
      if (err) return `.${k} ${err}`;
    }
    return null;
  };

interface Shape {
  required: Record<string, Check>;
  optional?: Record<string, Check>;
}

/** Validate an object against a shape; returns the first error or null. */
function checkShape(value: unknown, shape: Shape): string | null {
  if (!isObj(value)) return 'is not an object';
  for (const [field, check] of Object.entries(shape.required)) {
    if (!(field in value) || value[field] === undefined) return `is missing '${field}'`;
    const err = check(value[field]);
    if (err) return `field '${field}' ${err}`;
  }
  for (const [field, check] of Object.entries(shape.optional ?? {})) {
    if (value[field] === undefined) continue;
    const err = check(value[field]);
    if (err) return `field '${field}' ${err}`;
  }
  return null;
}
const shaped =
  (shape: Shape): Check =>
  (v) =>
    checkShape(v, shape);

const MAIN_SET: Shape = {
  required: {
    kind: oneOf(['warmup', 'work']),
    index: num,
    percent: num,
    weight: num,
    targetReps: num,
    amrap: bool,
  },
  optional: { actualReps: num, loggedAt: str },
};

const ACCESSORY_WORK: Shape = {
  required: {
    accessoryId: id,
    name: str,
    weight: num,
    targetSets: num,
    repRangeMin: num,
    repRangeMax: num,
    setReps: arrayOf(nullable(num)),
    progressed: bool,
  },
};

const SL_CYCLE_STATE: Shape = {
  required: {
    lifts: (v) => {
      if (!isObj(v)) return 'must be an object';
      for (const lift of SL_LIFTS) {
        const err = checkShape(v[lift], {
          required: { weight: num, increment: num, failStreak: num },
        });
        if (err) return `.${lift} ${err}`;
      }
      return null;
    },
    keepPrs: bool,
  },
};

/** One step of a saved routine (src/core/stretch/types.ts RoutineStep). */
const ROUTINE_STEP: Shape = {
  required: { stretchId: str, holdSec: num },
  optional: { side: oneOf(['left', 'right']), rep: num, repOf: num, noChair: bool },
};

/** Routine types (src/core/stretch/types.ts RoutineMode). */
const ROUTINE_MODE_VALUES = ['warmup', 'midday', 'winddown', 'focus'];

/**
 * A saved routine's snapshot. The fields the player reads to run and record a
 * session are required; the rest stay optional. Area names are strings only,
 * as for stretch sessions.
 */
const SAVED_ROUTINE_SNAPSHOT: Shape = {
  required: {
    minutes: num,
    focusAreas: arrayOf(str),
    steps: arrayOf(shaped(ROUTINE_STEP)),
    totalSec: num,
  },
  optional: {
    seed: num,
    reps: num,
    droppedAreas: arrayOf(str),
    mode: oneOf(ROUTINE_MODE_VALUES),
    // Strings only, like areas: the vocabularies belong to the stretch feature.
    excluded: arrayOf(str),
    lift: oneOf(['press', 'bench', 'squat', 'deadlift']),
    skippedSlots: arrayOf(str),
    breathing: bool,
  },
};

const TABLE_SHAPES: Record<keyof BackupData, Shape> = {
  settings: {
    required: {
      // getSettings() reads this fixed key; any other id would strand the
      // import in onboarding with the real row unreachable.
      id: oneOf(['singleton']),
      units: oneOf(UNITS),
      roundingIncrement: num,
      tmPercent: num,
      includeDeload: bool,
      liftIncrements: numberRecord(LIFTS),
      onboardingComplete: bool,
      schemaVersion: num,
    },
    optional: {
      // Shape only: normalizeDayOrder() already falls back on a bad permutation.
      dayOrder: arrayOf(str),
      prResets: arrayOf(str),
      pendingProgramSwitch: oneOf(['sl5x5', 'five31']),
    },
  },
  liftState: {
    required: { liftId: oneOf(LIFTS), trainingMax: num },
  },
  cycles: {
    required: {
      id,
      number: num,
      status: oneOf(['active', 'completed']),
      startedAt: str,
      tms: numberRecord(LIFTS),
      includeDeload: bool,
      units: oneOf(UNITS),
    },
    optional: {
      completedAt: str,
      program: oneOf(['sl5x5']),
      sl: shaped(SL_CYCLE_STATE),
    },
  },
  workouts: {
    required: {
      id,
      cycleId: id,
      cycleNumber: num,
      week: oneOf([1, 2, 3, 4]),
      liftId: oneOf(SL_LIFTS),
      status: oneOf(['pending', 'in_progress', 'completed', 'skipped']),
      tmUsed: num,
      mainSets: arrayOf(shaped(MAIN_SET)),
      accessoryWork: arrayOf(shaped(ACCESSORY_WORK)),
      units: oneOf(UNITS),
    },
    optional: {
      startedAt: str,
      completedAt: str,
      notes: str,
      editedAt: str,
      program: oneOf(['sl5x5']),
      session: num,
      slSlot: oneOf(['A', 'B']),
    },
  },
  accessories: {
    required: {
      id,
      liftDayId: oneOf(LIFTS),
      name: str,
      sets: num,
      repRangeMin: num,
      repRangeMax: num,
      currentWeight: num,
      increment: num,
      order: num,
      createdAt: str,
    },
    optional: { archivedAt: str },
  },
  bodyweight: {
    required: { id, date: str, weight: num, units: oneOf(UNITS) },
  },
  tmEvents: {
    required: {
      id,
      liftId: oneOf(LIFTS),
      cycleId: nullable(id),
      timestamp: str,
      type: oneOf(['initial', 'cycle_advance', 'manual_override', 'unit_conversion']),
      fromValue: nullable(num),
      toValue: num,
    },
    optional: { note: str },
  },
  stretchSessions: {
    required: {
      id,
      date: str,
      startedAt: num,
      completedAt: num,
      plannedSec: num,
      actualSec: num,
      minutes: num,
      // Element type is string only: the body-area vocabulary belongs to the
      // stretch feature and may grow; an unknown area must not reject a backup.
      focusAreas: arrayOf(str),
      stretchIds: arrayOf(str),
    },
    optional: { mode: oneOf(ROUTINE_MODE_VALUES) },
  },
  savedRoutines: {
    required: {
      id,
      name: str,
      createdAt: num,
      updatedAt: num,
      routine: shaped(SAVED_ROUTINE_SNAPSHOT),
    },
  },
};

/** The primary-key field of each table, for duplicate-key detection. */
const PRIMARY_KEYS: Record<keyof BackupData, string> = {
  settings: 'id',
  liftState: 'liftId',
  cycles: 'id',
  workouts: 'id',
  accessories: 'id',
  bodyweight: 'id',
  tmEvents: 'id',
  stretchSessions: 'id',
  savedRoutines: 'id',
};

/**
 * Structural validation of the MIGRATED (current-shape) payload. Throws a
 * {@link BackupValidationError} naming the table and row index on the first
 * failure. Pure: never touches the database.
 */
function validateRows(data: BackupData): void {
  for (const table of Object.keys(TABLE_SHAPES) as (keyof BackupData)[]) {
    const rows = data[table];
    if (rows === undefined) continue; // only versioned tables may be absent (older files)
    if (!Array.isArray(rows)) {
      throw new BackupValidationError(`Backup is missing the '${table}' array.`);
    }
    const shape = TABLE_SHAPES[table];
    const pk = PRIMARY_KEYS[table];
    const seen = new Set<unknown>();
    rows.forEach((row: unknown, index: number) => {
      const err = checkShape(row, shape);
      if (err) {
        throw new BackupValidationError(`Backup table '${table}' row ${index} ${err}.`);
      }
      // A duplicate primary key would make bulkAdd fail mid-import (the
      // transaction would roll back, but the message would be opaque).
      const key = (row as Record<string, unknown>)[pk];
      if (seen.has(key)) {
        throw new BackupValidationError(
          `Backup table '${table}' row ${index} repeats ${pk} '${String(key)}'.`,
        );
      }
      seen.add(key);
    });
  }

  // A StrongLifts cycle without its runtime would throw on every SL screen.
  data.cycles.forEach((c, index) => {
    if (c.program === 'sl5x5' && c.sl === undefined) {
      throw new BackupValidationError(
        `Backup table 'cycles' row ${index} is a StrongLifts cycle with no 'sl' runtime.`,
      );
    }
  });
  if (data.cycles.filter((c) => c.status === 'active').length > 1) {
    throw new BackupValidationError('Backup has more than one active cycle.');
  }

  // Settings cardinality: exactly one row whenever anything else is present
  // (zero would dead-end in onboarding with the data unreachable), and never
  // more than one.
  const otherRows = (Object.keys(TABLE_SHAPES) as (keyof BackupData)[])
    .filter((t) => t !== 'settings')
    .some((t) => (data[t]?.length ?? 0) > 0);
  if (data.settings.length > 1) {
    throw new BackupValidationError(
      `Backup has ${data.settings.length} settings rows; expected at most one.`,
    );
  }
  if (otherRows && data.settings.length !== 1) {
    throw new BackupValidationError('Backup has training data but no settings row.');
  }
}

/**
 * Validate that an unknown value is a well-formed FIVE31 backup: the `five31`
 * discriminator, an integer schemaVersion between 1 and the app's, a `data`
 * object whose seven core tables are all arrays (plus `stretchSessions` from
 * schemaVersion 2 and `savedRoutines` from 3), and, AFTER migrating a copy to the current shape, every row
 * of every table structurally valid. Throws {@link BackupValidationError} on any
 * failure. Pure (no DB access), so it runs before any mutation. Returns the
 * value narrowed to {@link BackupFile}.
 */
export function validateBackup(value: unknown): BackupFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BackupValidationError('Backup is not an object.');
  }
  const file = value as Partial<BackupFile>;
  if (file.app !== BACKUP_APP) {
    throw new BackupValidationError(`Not a FIVE31 backup (app='${String(file.app)}').`);
  }
  const version = file.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new BackupValidationError(
      `Backup schemaVersion '${String(version)}' is not a valid version (an integer of 1 or more).`,
    );
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new BackupValidationError(
      `Backup schemaVersion ${version} is newer than this app (v${CURRENT_SCHEMA_VERSION}); update FIVE31 to import it.`,
    );
  }
  if (!file.data || typeof file.data !== 'object' || Array.isArray(file.data)) {
    throw new BackupValidationError('Backup has no data.');
  }
  const data = file.data as Record<string, unknown>;
  for (const table of BACKUP_TABLES) {
    if (!Array.isArray(data[table])) {
      throw new BackupValidationError(`Backup is missing the '${table}' array.`);
    }
  }
  for (const { table, since } of VERSIONED_TABLES) {
    if (version >= since && !Array.isArray(data[table])) {
      throw new BackupValidationError(`Backup is missing the '${table}' array.`);
    }
  }

  validateRows(migrateOrReject(file as BackupFile));
  return file as BackupFile;
}

/** migrateBackup, with any ladder failure surfaced as a validation error. */
function migrateOrReject(file: BackupFile): BackupData {
  try {
    return migrateBackup(file.data, file.schemaVersion);
  } catch (err) {
    throw new BackupValidationError(
      err instanceof Error ? err.message : 'Backup could not be migrated.',
    );
  }
}

/**
 * What an import will do to the stretch log, for the confirmation summary:
 * a file older than the table (schemaVersion < 2) carries no stretch data at
 * all, so the existing log is KEPT; a v2+ file replaces it.
 */
export type StretchImportPlan = { mode: 'kept' } | { mode: 'replaced'; count: number };

export function stretchImportPlan(file: BackupFile): StretchImportPlan {
  if (file.schemaVersion < STRETCH_SESSIONS_SINCE) return { mode: 'kept' };
  return { mode: 'replaced', count: file.data.stretchSessions?.length ?? 0 };
}

/**
 * Same rule for saved routines: a file older than the table (schemaVersion
 * < 3) KEEPS the routines on this device; a v3+ file replaces them.
 */
export function savedRoutinesImportPlan(file: BackupFile): StretchImportPlan {
  if (file.schemaVersion < SAVED_ROUTINES_SINCE) return { mode: 'kept' };
  return { mode: 'replaced', count: file.data.savedRoutines?.length ?? 0 };
}

/**
 * Replace the database from a backup file. Validates everything (header, then
 * every row of the migrated payload) BEFORE any mutation, then in ONE
 * transaction clears and bulk-adds each table. All-or-nothing.
 *
 * Stretch sessions: a backup that predates the table (schemaVersion < 2) leaves
 * the existing stretch log untouched; a v2+ backup replaces it. Saved routines
 * likewise: kept for a file below schemaVersion 3, replaced from v3.
 */
export async function importBackup(file: BackupFile): Promise<void> {
  validateBackup(file);

  const data = migrateOrReject(file);
  const replaceStretch = stretchImportPlan(file).mode === 'replaced';
  const replaceSaved = savedRoutinesImportPlan(file).mode === 'replaced';

  await db.transaction('rw', allTables(), async () => {
    await Promise.all([
      db.settings.clear(),
      db.liftState.clear(),
      db.cycles.clear(),
      db.workouts.clear(),
      db.accessories.clear(),
      db.bodyweight.clear(),
      db.tmEvents.clear(),
      replaceStretch ? db.stretchSessions.clear() : Promise.resolve(),
      replaceSaved ? db.savedRoutines.clear() : Promise.resolve(),
    ]);
    await Promise.all([
      db.settings.bulkAdd(data.settings),
      db.liftState.bulkAdd(data.liftState),
      db.cycles.bulkAdd(data.cycles),
      db.workouts.bulkAdd(data.workouts),
      db.accessories.bulkAdd(data.accessories),
      db.bodyweight.bulkAdd(data.bodyweight),
      db.tmEvents.bulkAdd(data.tmEvents),
      replaceStretch ? db.stretchSessions.bulkAdd(data.stretchSessions ?? []) : Promise.resolve(),
      replaceSaved ? db.savedRoutines.bulkAdd(data.savedRoutines ?? []) : Promise.resolve(),
    ]);
  });
}

/**
 * Parse a JSON string into a fully-validated BackupFile. Throws a
 * {@link BackupValidationError} on malformed JSON OR on any shape violation, so
 * callers can safely read `.data.*.length` (e.g. for an import summary) without
 * a render-time crash on a non-FIVE31 file.
 */
export function parseBackupJson(json: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new BackupValidationError('Backup file is not valid JSON.');
  }
  return validateBackup(parsed);
}
