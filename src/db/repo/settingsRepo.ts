import type { Settings } from '../../core/types.ts';
import { db, SETTINGS_ID } from '../db.ts';

/** Read the singleton Settings row, or undefined before onboarding. */
export async function getSettings(): Promise<Settings | undefined> {
  return db.settings.get(SETTINGS_ID);
}

/**
 * Read the singleton Settings row, throwing if it does not exist yet. Use this
 * from flows that only run after onboarding has completed.
 */
export async function requireSettings(): Promise<Settings> {
  const s = await db.settings.get(SETTINGS_ID);
  if (!s) throw new Error('Settings not initialized (onboarding incomplete).');
  return s;
}

/**
 * Merge a partial update into the singleton Settings row. The `id` is always
 * pinned to the singleton key, so callers cannot fork a second row.
 */
export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const current = await db.settings.get(SETTINGS_ID);
    if (!current) throw new Error('Settings not initialized (onboarding incomplete).');
    await db.settings.put({ ...current, ...patch, id: SETTINGS_ID });
  });
}
