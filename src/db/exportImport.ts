import type { BackupFile } from '../core/types.ts';
import { db } from './db.ts';
import { CURRENT_SCHEMA_VERSION, migrateBackup } from './migrations.ts';

/** The `app` discriminator every FIVE31 backup carries. */
export const BACKUP_APP = 'five31' as const;

/**
 * Serialize the entire database into a portable backup object (all 7 tables).
 * Pure read — no mutation.
 */
export async function exportBackup(): Promise<BackupFile> {
  const [settings, liftState, cycles, workouts, accessories, bodyweight, tmEvents] =
    await db.transaction(
      'r',
      [db.settings, db.liftState, db.cycles, db.workouts, db.accessories, db.bodyweight, db.tmEvents],
      async () => {
        return Promise.all([
          db.settings.toArray(),
          db.liftState.toArray(),
          db.cycles.toArray(),
          db.workouts.toArray(),
          db.accessories.toArray(),
          db.bodyweight.toArray(),
          db.tmEvents.toArray(),
        ]);
      },
    );

  return {
    app: BACKUP_APP,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: { settings, liftState, cycles, workouts, accessories, bodyweight, tmEvents },
  };
}

/** Thrown when an import file fails validation before any DB mutation. */
export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

/** The seven data arrays every FIVE31 backup carries. */
const BACKUP_TABLES = [
  'settings',
  'liftState',
  'cycles',
  'workouts',
  'accessories',
  'bodyweight',
  'tmEvents',
] as const;

/**
 * Validate that an unknown value is a well-formed FIVE31 backup: the `five31`
 * discriminator, a numeric non-future schemaVersion, and a `data` object whose
 * seven tables are all arrays. Throws {@link BackupValidationError} on any
 * failure. Returns the value narrowed to {@link BackupFile} — after this the
 * import summary can safely read `data.*.length` without a render-time crash.
 */
export function validateBackup(value: unknown): BackupFile {
  if (!value || typeof value !== 'object') {
    throw new BackupValidationError('Backup is not an object.');
  }
  const file = value as Partial<BackupFile>;
  if (file.app !== BACKUP_APP) {
    throw new BackupValidationError(`Not a FIVE31 backup (app='${String(file.app)}').`);
  }
  if (typeof file.schemaVersion !== 'number') {
    throw new BackupValidationError('Backup is missing a numeric schemaVersion.');
  }
  if (file.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new BackupValidationError(
      `Backup schemaVersion ${file.schemaVersion} is newer than this app (v${CURRENT_SCHEMA_VERSION}); update FIVE31 to import it.`,
    );
  }
  if (!file.data || typeof file.data !== 'object') {
    throw new BackupValidationError('Backup has no data.');
  }
  const data = file.data as Record<string, unknown>;
  for (const table of BACKUP_TABLES) {
    if (!Array.isArray(data[table])) {
      throw new BackupValidationError(`Backup is missing the '${table}' array.`);
    }
  }
  return file as BackupFile;
}

/**
 * Replace the entire database from a backup file. Validates the discriminator
 * and schema version, migrates the payload forward, then in ONE transaction
 * clears all 7 tables and bulk-adds everything. All-or-nothing.
 */
export async function importBackup(file: BackupFile): Promise<void> {
  validateBackup(file);

  const data = migrateBackup(file.data, file.schemaVersion);

  await db.transaction(
    'rw',
    [db.settings, db.liftState, db.cycles, db.workouts, db.accessories, db.bodyweight, db.tmEvents],
    async () => {
      await Promise.all([
        db.settings.clear(),
        db.liftState.clear(),
        db.cycles.clear(),
        db.workouts.clear(),
        db.accessories.clear(),
        db.bodyweight.clear(),
        db.tmEvents.clear(),
      ]);
      await Promise.all([
        db.settings.bulkAdd(data.settings),
        db.liftState.bulkAdd(data.liftState),
        db.cycles.bulkAdd(data.cycles),
        db.workouts.bulkAdd(data.workouts),
        db.accessories.bulkAdd(data.accessories),
        db.bodyweight.bulkAdd(data.bodyweight),
        db.tmEvents.bulkAdd(data.tmEvents),
      ]);
    },
  );
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
