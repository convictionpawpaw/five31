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

// ---------------------------------------------------------------------------
// Program switching
// ---------------------------------------------------------------------------

/** The programs a pending switch can name (`undefined` IS "nothing armed"). */
export type PendingProgramSwitch = NonNullable<Settings['pendingProgramSwitch']>;

/**
 * A copy of `settings` with `pendingProgramSwitch` DELETED — the key is removed,
 * not set to `undefined`, so a row that was never armed and a row that has been
 * disarmed are indistinguishable (the friend-path pins assert exactly this). Pure.
 */
function withoutPendingProgramSwitch(settings: Settings): Settings {
  const next = { ...settings };
  delete next.pendingProgramSwitch;
  return next;
}

/**
 * A copy of `settings` with `at` appended to the append-only `prResets` list.
 * Never reorders or rewrites earlier markers, so every PR epoch stays
 * reconstructible and pre-reset badges survive in History. Pure.
 */
export function appendPrReset(settings: Settings, at: string): Settings {
  return { ...settings, prResets: [...(settings.prResets ?? []), at] };
}

/**
 * The Settings row a CONFIRMED program switch writes: the armed
 * `pendingProgramSwitch` is consumed (removed), and when the user chose NOT to
 * keep PRs a reset marker is appended at `at`. Pure, so the switch functions in
 * cycleRepo write the result inside their own single transaction rather than
 * opening a second one.
 */
export function settingsAfterProgramSwitch(
  settings: Settings,
  keepPrs: boolean,
  at: string,
): Settings {
  const disarmed = withoutPendingProgramSwitch(settings);
  return keepPrs ? disarmed : appendPrReset(disarmed, at);
}

/** Arm a program switch, to be applied at the NEXT cycle completion. */
export async function setPendingProgramSwitch(program: PendingProgramSwitch): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const current = await requireSettings();
    await db.settings.put({ ...current, pendingProgramSwitch: program, id: SETTINGS_ID });
  });
}

/**
 * Disarm a pending program switch — the "cancel" chip in Settings, and the path
 * a Complete-Cycle modal takes when the user declines the armed switch and
 * continues on the program they are already running.
 */
export async function clearPendingProgramSwitch(): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const current = await requireSettings();
    await db.settings.put({ ...withoutPendingProgramSwitch(current), id: SETTINGS_ID });
  });
}
