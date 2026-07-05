import { ulid } from 'ulid';
import type { BodyweightEntry, Units } from '../../core/types.ts';
import { db } from '../db.ts';

/**
 * Upsert a bodyweight entry keyed by calendar date: if an entry already exists
 * for `date` it is overwritten (weight/units updated), otherwise a new one is
 * created. `date` is an ISO date string (e.g. '2026-07-05').
 */
export async function upsertBodyweight(
  date: string,
  weight: number,
  units: Units,
): Promise<BodyweightEntry> {
  return db.transaction('rw', db.bodyweight, async () => {
    const existing = await db.bodyweight.where('date').equals(date).first();
    const entry: BodyweightEntry = {
      id: existing?.id ?? ulid(),
      date,
      weight,
      units,
    };
    await db.bodyweight.put(entry);
    return entry;
  });
}

/** List all bodyweight entries, oldest date first. */
export async function listBodyweight(): Promise<BodyweightEntry[]> {
  const entries = await db.bodyweight.toArray();
  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

/** Delete a bodyweight entry by id. */
export async function deleteBodyweight(id: string): Promise<void> {
  await db.bodyweight.delete(id);
}
