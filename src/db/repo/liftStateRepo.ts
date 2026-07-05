import type { LiftId, LiftState } from '../../core/types.ts';
import { DAY_ORDER } from '../../core/scheme.ts';
import { db } from '../db.ts';

/** Read one lift's authoritative current Training Max, or undefined. */
export async function getLiftState(liftId: LiftId): Promise<LiftState | undefined> {
  return db.liftState.get(liftId);
}

/** Read all four lift states, ordered by DAY_ORDER. */
export async function getAllLiftStates(): Promise<LiftState[]> {
  const rows = await db.liftState.toArray();
  const byLift = new Map(rows.map((r) => [r.liftId, r]));
  return DAY_ORDER.map((liftId) => byLift.get(liftId)).filter(
    (r): r is LiftState => r !== undefined,
  );
}

/** Read every current TM as a Record keyed by lift. Missing lifts are omitted. */
export async function getTrainingMaxes(): Promise<Partial<Record<LiftId, number>>> {
  const rows = await db.liftState.toArray();
  const out: Partial<Record<LiftId, number>> = {};
  for (const r of rows) out[r.liftId] = r.trainingMax;
  return out;
}

/** Set (create or overwrite) one lift's Training Max. Does NOT write a TmEvent. */
export async function setTrainingMax(liftId: LiftId, trainingMax: number): Promise<void> {
  await db.liftState.put({ liftId, trainingMax });
}
