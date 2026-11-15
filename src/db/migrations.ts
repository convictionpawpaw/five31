import type { BackupFile } from '../core/types.ts';

/**
 * The schema version the running app writes and understands. Bump this whenever
 * the on-disk shape changes and add a corresponding step to {@link BACKUP_MIGRATIONS}.
 */
export const CURRENT_SCHEMA_VERSION = 2;

/**
 * The mutable payload carried through the migration stepper. It is the `data`
 * portion of a {@link BackupFile}, kept loosely typed (`unknown`-ish) so older
 * shapes that predate the current interfaces can still be walked forward.
 */
export type BackupData = BackupFile['data'];

/**
 * A single forward migration step: takes the backup data as produced by version
 * `fromVersion` and returns it shaped for `fromVersion + 1`.
 */
export type MigrationStep = (data: BackupData) => BackupData;

/**
 * Ordered forward migrations, indexed by the version they migrate FROM.
 *
 * A backup exported at schemaVersion N is brought up to CURRENT_SCHEMA_VERSION by
 * applying, in order, the step at index N, then N+1, … up to CURRENT-1. There is
 * no step at index CURRENT_SCHEMA_VERSION (nothing to do once current).
 *
 * v1 is the first schema, so there is no v0→v1 step.
 *   1 → 2: adds the (empty) `stretchSessions` table.
 */
export const BACKUP_MIGRATIONS: Record<number, MigrationStep> = {
  1: (data) => ({ ...data, stretchSessions: data.stretchSessions ?? [] }),
};

/**
 * Bring an imported backup's data forward to {@link CURRENT_SCHEMA_VERSION} by
 * running each registered step in sequence. A v1 backup on a v1 app is the
 * identity. Throws if `fromVersion` is not an integer >= 1, or if a required
 * step is missing (a gap in the ladder). Callers on the import path wrap these
 * as BackupValidationError (see exportImport.ts).
 */
export function migrateBackup(data: BackupData, fromVersion: number): BackupData {
  // NaN, fractions, 0 and negatives would otherwise skip or mis-walk the ladder.
  if (!Number.isInteger(fromVersion) || fromVersion < 1) {
    throw new Error(`Backup schemaVersion '${String(fromVersion)}' is not a valid version.`);
  }
  if (fromVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Backup schemaVersion ${fromVersion} is newer than this app (v${CURRENT_SCHEMA_VERSION}).`,
    );
  }

  let current = data;
  for (let v = fromVersion; v < CURRENT_SCHEMA_VERSION; v++) {
    const step = BACKUP_MIGRATIONS[v];
    if (!step) {
      throw new Error(`Missing backup migration step for schemaVersion ${v}.`);
    }
    current = step(current);
  }
  return current;
}
