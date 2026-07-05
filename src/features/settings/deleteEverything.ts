import { db } from '../../db/db.ts';

/**
 * FULL RESET — wipe every table and reload the app so it boots back into
 * onboarding. Lives INSIDE the settings feature (not src/db) because it is a
 * destructive UI affordance, not part of the persistence contract. Import-only:
 * it uses the existing db instance and does not modify any db module.
 *
 * Deletes the whole IndexedDB database (not just clears tables) so a corrupt
 * schema can't survive a reset, then hard-reloads.
 */
export async function deleteEverything(): Promise<void> {
  await db.delete();
  // Reload to re-open a fresh DB and re-run onboarding.
  if (typeof location !== 'undefined') location.reload();
}
