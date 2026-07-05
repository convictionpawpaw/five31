import { ulid } from 'ulid';
import type { AccessoryDef, LiftId } from '../../core/types.ts';
import { db } from '../db.ts';

/** Maximum number of ACTIVE (non-archived) accessories allowed per lift day. */
export const MAX_ACTIVE_ACCESSORIES_PER_DAY = 3;

/** Input for creating a new accessory definition (id/order/createdAt filled in). */
export interface NewAccessoryInput {
  liftDayId: LiftId;
  name: string;
  sets: number;
  repRangeMin: number;
  repRangeMax: number;
  currentWeight: number;
  increment: number;
  /** Optional explicit order; defaults to append after the current max. */
  order?: number;
}

/** Active (non-archived) accessories for a lift day, in `order`. */
export async function listActiveAccessories(liftDayId: LiftId): Promise<AccessoryDef[]> {
  const rows = await db.accessories.where('liftDayId').equals(liftDayId).toArray();
  return rows.filter((a) => a.archivedAt === undefined).sort((a, b) => a.order - b.order);
}

/** Every accessory for a lift day, archived or not, in `order`. */
export async function listAllAccessories(liftDayId: LiftId): Promise<AccessoryDef[]> {
  const rows = await db.accessories.where('liftDayId').equals(liftDayId).toArray();
  return rows.sort((a, b) => a.order - b.order);
}

/** All accessories across every day (used by export). */
export async function listEveryAccessory(): Promise<AccessoryDef[]> {
  return db.accessories.toArray();
}

/**
 * Add a new accessory to a lift day. Enforces at most
 * {@link MAX_ACTIVE_ACCESSORIES_PER_DAY} active accessories per day (throws if
 * the cap is already reached). Order defaults to one past the current max.
 */
export async function addAccessory(input: NewAccessoryInput): Promise<AccessoryDef> {
  return db.transaction('rw', db.accessories, async () => {
    const existing = await db.accessories.where('liftDayId').equals(input.liftDayId).toArray();
    const active = existing.filter((a) => a.archivedAt === undefined);
    if (active.length >= MAX_ACTIVE_ACCESSORIES_PER_DAY) {
      throw new Error(
        `Cannot add accessory: ${input.liftDayId} already has ${MAX_ACTIVE_ACCESSORIES_PER_DAY} active accessories.`,
      );
    }
    const maxOrder = existing.reduce((m, a) => Math.max(m, a.order), -1);
    const def: AccessoryDef = {
      id: ulid(),
      liftDayId: input.liftDayId,
      name: input.name,
      sets: input.sets,
      repRangeMin: input.repRangeMin,
      repRangeMax: input.repRangeMax,
      currentWeight: input.currentWeight,
      increment: input.increment,
      order: input.order ?? maxOrder + 1,
      createdAt: new Date().toISOString(),
    };
    await db.accessories.add(def);
    return def;
  });
}

/**
 * Fields the caller may update on an accessory definition. Structural identity
 * (id, liftDayId, createdAt, archivedAt) is not editable here.
 */
export type AccessoryUpdate = Partial<
  Pick<
    AccessoryDef,
    'name' | 'sets' | 'repRangeMin' | 'repRangeMax' | 'currentWeight' | 'increment' | 'order'
  >
>;

/** Patch an accessory definition. Affects only FUTURE workouts (snapshots freeze history). */
export async function updateAccessory(id: string, patch: AccessoryUpdate): Promise<void> {
  await db.transaction('rw', db.accessories, async () => {
    const current = await db.accessories.get(id);
    if (!current) throw new Error(`Accessory ${id} not found.`);
    await db.accessories.put({ ...current, ...patch });
  });
}

/**
 * Reorder the active accessories of a lift day. `orderedIds` lists the active
 * accessory ids in the desired order; each is assigned its index as `order`.
 */
export async function reorderAccessories(
  liftDayId: LiftId,
  orderedIds: readonly string[],
): Promise<void> {
  await db.transaction('rw', db.accessories, async () => {
    const rows = await db.accessories.where('liftDayId').equals(liftDayId).toArray();
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i]!;
      const row = byId.get(id);
      if (!row) throw new Error(`Accessory ${id} not on day ${liftDayId}.`);
      await db.accessories.put({ ...row, order: i });
    }
  });
}

/** Soft-delete an accessory (sets archivedAt); history keeps its snapshots. */
export async function archiveAccessory(id: string): Promise<void> {
  await db.transaction('rw', db.accessories, async () => {
    const current = await db.accessories.get(id);
    if (!current) throw new Error(`Accessory ${id} not found.`);
    if (current.archivedAt !== undefined) return; // already archived
    await db.accessories.put({ ...current, archivedAt: new Date().toISOString() });
  });
}
