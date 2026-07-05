import { ulid } from 'ulid';
import type { LiftId, TmEvent } from '../../core/types.ts';
import { db } from '../db.ts';

/** Fields the caller supplies; id + timestamp are stamped here unless provided. */
export type NewTmEvent = Omit<TmEvent, 'id' | 'timestamp'> & {
  id?: string;
  timestamp?: string;
};

/** Materialize a NewTmEvent into a full TmEvent (id + ISO timestamp filled in). */
export function makeTmEvent(input: NewTmEvent): TmEvent {
  return {
    id: input.id ?? ulid(),
    liftId: input.liftId,
    cycleId: input.cycleId,
    timestamp: input.timestamp ?? new Date().toISOString(),
    type: input.type,
    fromValue: input.fromValue,
    toValue: input.toValue,
    ...(input.note !== undefined ? { note: input.note } : {}),
  };
}

/** Append a single TM audit-log event. */
export async function appendTmEvent(input: NewTmEvent): Promise<TmEvent> {
  const event = makeTmEvent(input);
  await db.tmEvents.add(event);
  return event;
}

/** List all TM events for a lift, oldest first (ULID ids sort chronologically). */
export async function listTmEventsByLift(liftId: LiftId): Promise<TmEvent[]> {
  const events = await db.tmEvents.where('liftId').equals(liftId).toArray();
  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** List the entire TM audit log, oldest first. */
export async function listAllTmEvents(): Promise<TmEvent[]> {
  const events = await db.tmEvents.toArray();
  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
