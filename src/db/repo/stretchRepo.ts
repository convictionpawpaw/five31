import { ulid } from 'ulid';
import type { StretchSession } from '../../core/stretch/types.ts';
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
