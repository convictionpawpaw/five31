import Dexie, { type EntityTable } from 'dexie';
import type {
  AccessoryDef,
  BodyweightEntry,
  Cycle,
  LiftState,
  Settings,
  TmEvent,
  Workout,
} from '../core/types.ts';

/**
 * The FIVE31 IndexedDB database.
 *
 * Version 1 stores (verbatim from the plan):
 *   settings:'id'
 *   liftState:'liftId'
 *   cycles:'id, number, status'
 *   workouts:'id, cycleId, status, liftId, completedAt, [cycleId+week+liftId]'
 *   accessories:'id, liftDayId'
 *   bodyweight:'id, date'
 *   tmEvents:'id, liftId, timestamp'
 */
export class Five31DB extends Dexie {
  settings!: EntityTable<Settings, 'id'>;
  liftState!: EntityTable<LiftState, 'liftId'>;
  cycles!: EntityTable<Cycle, 'id'>;
  workouts!: EntityTable<Workout, 'id'>;
  accessories!: EntityTable<AccessoryDef, 'id'>;
  bodyweight!: EntityTable<BodyweightEntry, 'id'>;
  tmEvents!: EntityTable<TmEvent, 'id'>;

  constructor() {
    super('five31');
    this.version(1).stores({
      settings: 'id',
      liftState: 'liftId',
      cycles: 'id, number, status',
      workouts: 'id, cycleId, status, liftId, completedAt, [cycleId+week+liftId]',
      accessories: 'id, liftDayId',
      bodyweight: 'id, date',
      tmEvents: 'id, liftId, timestamp',
    });
  }
}

/** The singleton database instance used by every repo. */
export const db = new Five31DB();

/** The fixed primary key of the single Settings row. */
export const SETTINGS_ID = 'singleton' as const;
