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
import type { SavedRoutine, StretchSession } from '../core/stretch/types.ts';

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
 *
 * Version 2 adds (v1 is kept verbatim so existing installs upgrade in place):
 *   stretchSessions:'id, date'
 *
 * Version 3 adds (v1 and v2 kept verbatim):
 *   savedRoutines:'id, createdAt'
 */
export class Five31DB extends Dexie {
  settings!: EntityTable<Settings, 'id'>;
  liftState!: EntityTable<LiftState, 'liftId'>;
  cycles!: EntityTable<Cycle, 'id'>;
  workouts!: EntityTable<Workout, 'id'>;
  accessories!: EntityTable<AccessoryDef, 'id'>;
  bodyweight!: EntityTable<BodyweightEntry, 'id'>;
  tmEvents!: EntityTable<TmEvent, 'id'>;
  stretchSessions!: EntityTable<StretchSession, 'id'>;
  savedRoutines!: EntityTable<SavedRoutine, 'id'>;

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
    // Additive: Dexie carries every v1 table forward unchanged.
    this.version(2).stores({
      stretchSessions: 'id, date',
    });
    // Additive again: every v2 table carries forward unchanged.
    this.version(3).stores({
      savedRoutines: 'id, createdAt',
    });
  }
}

/** The singleton database instance used by every repo. */
export const db = new Five31DB();

/** The fixed primary key of the single Settings row. */
export const SETTINGS_ID = 'singleton' as const;
