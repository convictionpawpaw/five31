import { ulid } from 'ulid';
import type { Routine, SavedRoutine, StretchSession } from '../../core/stretch/types.ts';
import { db } from '../db.ts';

/** A session to record; the id is assigned here. */
export type NewStretchSession = Omit<StretchSession, 'id'>;

/**
 * Record a finished stretch session. Stretch sessions are an append-only log:
 * there is no update or delete path, so the streak can only be earned by
 * actually stretching. Returns the stored row.
 */
export async function addStretchSession(input: NewStretchSession): Promise<StretchSession> {
  const row: StretchSession = {
    id: ulid(),
    ...input,
    focusAreas: [...input.focusAreas],
    stretchIds: [...input.stretchIds],
  };
  await db.stretchSessions.add(row);
  return row;
}

/** Every stretch session, oldest first (by local day, then start time). */
export async function listStretchSessions(): Promise<StretchSession[]> {
  const rows = await db.stretchSessions.toArray();
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.startedAt - b.startedAt);
}

/** The distinct local days that have at least one session, ascending. */
export async function listStretchDays(): Promise<string[]> {
  const keys = (await db.stretchSessions.orderBy('date').uniqueKeys()) as string[];
  return [...keys].sort();
}

/**
 * Stretch ids from the most recent `sessions` sessions (newest first, no
 * duplicates), fed to the generator so consecutive routines vary.
 */
export async function recentStretchIds(sessions = 2): Promise<string[]> {
  const rows = await listStretchSessions();
  const ids: string[] = [];
  for (const row of rows.slice(-sessions).reverse()) {
    for (const id of row.stretchIds) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

// --- Saved routines -----------------------------------------------------------

/** Longest allowed saved-routine name, after trimming. */
export const ROUTINE_NAME_MAX = 40;

/** Thrown when a saved-routine name is empty or too long after trimming. */
export class RoutineNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutineNameError';
  }
}

/** Trim a routine name and check it is 1..{@link ROUTINE_NAME_MAX} characters. */
export function normalizeRoutineName(name: string): string {
  const n = typeof name === 'string' ? name.trim() : '';
  if (n.length === 0) throw new RoutineNameError('Give the routine a name.');
  if (n.length > ROUTINE_NAME_MAX) {
    throw new RoutineNameError(`Keep the name to ${ROUTINE_NAME_MAX} characters or fewer.`);
  }
  return n;
}

/**
 * Save a routine under a name (duplicates allowed). The routine is stored as a
 * full snapshot, so it replays exactly as it was shown. Returns the stored row.
 */
export async function addSavedRoutine(
  name: string,
  routine: Routine,
  now: number = Date.now(),
): Promise<SavedRoutine> {
  const row: SavedRoutine = {
    id: ulid(),
    name: normalizeRoutineName(name),
    createdAt: now,
    updatedAt: now,
    routine: structuredClone(routine),
  };
  await db.savedRoutines.add(row);
  return row;
}

/** Every saved routine, newest first. */
export async function listSavedRoutines(): Promise<SavedRoutine[]> {
  const rows = await db.savedRoutines.toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

/** Rename a saved routine. Throws if the name is invalid or the routine is gone. */
export async function renameSavedRoutine(
  id: string,
  name: string,
  now: number = Date.now(),
): Promise<void> {
  const n = normalizeRoutineName(name);
  const changed = await db.savedRoutines.update(id, { name: n, updatedAt: now });
  if (changed === 0 && !(await db.savedRoutines.get(id))) {
    throw new Error('That saved routine no longer exists.');
  }
}

/** Delete a saved routine (no-op when it is already gone). */
export async function deleteSavedRoutine(id: string): Promise<void> {
  await db.savedRoutines.delete(id);
}
