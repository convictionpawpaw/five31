import { exportBackup } from '../db/exportImport.ts';
import {
  browserShareEnv,
  defaultBackupFilename,
  prepareBackupFile,
  shareBackupFile,
  type ShareEnv,
  type ShareOutcome,
} from './share.ts';

/**
 * Export the whole database and hand it to the share sheet (or the download
 * fallback). Shared by Settings and the app error screen, so it depends on no
 * React state. Never throws: a failed DB read becomes a 'failed' outcome.
 */
export async function exportAndShareBackup(env: ShareEnv = browserShareEnv()): Promise<ShareOutcome> {
  let file: File;
  try {
    const backup = await exportBackup();
    file = prepareBackupFile(JSON.stringify(backup, null, 2), defaultBackupFilename());
  } catch (err) {
    return {
      kind: 'failed',
      message: err instanceof Error ? err.message : 'Could not read the database.',
    };
  }
  return shareBackupFile(file, env);
}
