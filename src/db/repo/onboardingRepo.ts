import { ulid } from 'ulid';
import type {
  AccessoryDef,
  Cycle,
  LiftId,
  LiftState,
  Settings,
  TmEvent,
  Units,
  Workout,
} from '../../core/types.ts';
import { DAY_ORDER, normalizeDayOrder } from '../../core/scheme.ts';
import { buildCycleWorkouts, type CycleLiftInput } from '../../core/cycle.ts';
import { db, SETTINGS_ID } from '../db.ts';
import { CURRENT_SCHEMA_VERSION } from '../migrations.ts';

/** One user-defined accessory captured during onboarding (pre-persistence). */
export interface OnboardingAccessoryInput {
  liftDayId: LiftId;
  name: string;
  sets: number;
  repRangeMin: number;
  repRangeMax: number;
  currentWeight: number;
  increment: number;
}

/**
 * Everything the onboarding wizard collects before it commits the first cycle.
 * This is the exact contract chunk C3 (onboarding UI) fills in and hands to
 * {@link initializeFromOnboarding}.
 */
export interface OnboardingPayload {
  units: Units;
  roundingIncrement: number;
  tmPercent: number;
  includeDeload: boolean;
  /**
   * Per-lift TM bump applied at cycle advance (progression ONLY). Set weights
   * are always rounded to `roundingIncrement`, never to these.
   */
  liftIncrements: Record<LiftId, number>;
  /** Chosen Training Max per lift (already derived from 1RM × tmPercent by the UI). */
  trainingMaxes: Record<LiftId, number>;
  /** Optional accessories (≤3 per day; the cap is enforced downstream). */
  accessories?: OnboardingAccessoryInput[];
  /**
   * Optional user-chosen training-day order. Absent ⇒ classic DAY_ORDER (the
   * wizard does not collect this — it defaults to classic, so the friend's
   * experience is unchanged). Validated via normalizeDayOrder before use.
   */
  dayOrder?: LiftId[];
}

/**
 * Create the entire initial state in ONE transaction:
 *  - Settings (onboardingComplete: true, schemaVersion = CURRENT).
 *  - LiftState per lift (authoritative TMs).
 *  - one 'initial' TmEvent per lift (fromValue null → chosen TM).
 *  - AccessoryDefs (in payload order, per-day order preserved).
 *  - Cycle 1 (status 'active', tms snapshot of the chosen TMs).
 *  - Cycle 1's workouts via core buildCycleWorkouts (all pending, frozen weights).
 *
 * All-or-nothing: if anything throws, the transaction rolls back and the DB is
 * left empty (onboarding can be retried cleanly).
 *
 * Guarded against double-initialization: if a Settings row OR any cycle already
 * exists, it throws {@link AlreadyInitializedError} inside the transaction (so
 * nothing is written) rather than silently creating a second active cycle and
 * corrupting app-wide state.
 */
export class AlreadyInitializedError extends Error {
  constructor() {
    super('Already initialized — use Full Reset first.');
    this.name = 'AlreadyInitializedError';
  }
}

export async function initializeFromOnboarding(payload: OnboardingPayload): Promise<void> {
  const {
    units,
    roundingIncrement,
    tmPercent,
    includeDeload,
    liftIncrements,
    trainingMaxes,
    accessories = [],
    dayOrder,
  } = payload;

  const now = new Date().toISOString();
  const cycleId = ulid();

  // Validate the requested order once; persist ONLY a valid custom order (a
  // classic/absent order leaves the field undefined so old-default rows and
  // this row stay identical).
  const normalizedOrder = normalizeDayOrder(dayOrder);

  const settings: Settings = {
    id: SETTINGS_ID,
    units,
    roundingIncrement,
    tmPercent,
    includeDeload,
    liftIncrements,
    ...(dayOrder !== undefined ? { dayOrder: [...normalizedOrder] } : {}),
    onboardingComplete: true,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };

  const liftStates: LiftState[] = DAY_ORDER.map((liftId) => ({
    liftId,
    trainingMax: trainingMaxes[liftId],
  }));

  const tmEvents: TmEvent[] = DAY_ORDER.map((liftId) => ({
    id: ulid(),
    liftId,
    cycleId,
    timestamp: now,
    type: 'initial',
    fromValue: null,
    toValue: trainingMaxes[liftId],
  }));

  // Accessory defs — preserve payload order, assign per-day order sequentially.
  const perDayCount: Partial<Record<LiftId, number>> = {};
  const accessoryDefs: AccessoryDef[] = accessories.map((a) => {
    const order = perDayCount[a.liftDayId] ?? 0;
    perDayCount[a.liftDayId] = order + 1;
    return {
      id: ulid(),
      liftDayId: a.liftDayId,
      name: a.name,
      sets: a.sets,
      repRangeMin: a.repRangeMin,
      repRangeMax: a.repRangeMax,
      currentWeight: a.currentWeight,
      increment: a.increment,
      order,
      createdAt: now,
    };
  });

  const cycle: Cycle = {
    id: cycleId,
    number: 1,
    status: 'active',
    startedAt: now,
    tms: { ...trainingMaxes },
    includeDeload,
    units,
  };

  // Set weights round to the global roundingIncrement (NOT the per-lift TM bumps).
  const lifts: Record<LiftId, CycleLiftInput> = DAY_ORDER.reduce(
    (acc, liftId) => {
      acc[liftId] = { tm: trainingMaxes[liftId], increment: roundingIncrement };
      return acc;
    },
    {} as Record<LiftId, CycleLiftInput>,
  );

  const workouts: Workout[] = buildCycleWorkouts({
    cycleId,
    cycleNumber: 1,
    includeDeload,
    units,
    lifts,
    ids: () => ulid(),
    dayOrder: normalizedOrder,
  });

  await db.transaction(
    'rw',
    [db.settings, db.liftState, db.tmEvents, db.accessories, db.cycles, db.workouts],
    async () => {
      // Refuse to write over an already-initialized DB (would create a second
      // active cycle and corrupt every getActiveCycle() consumer).
      const existingSettings = await db.settings.get(SETTINGS_ID);
      const anyCycle = await db.cycles.count();
      if (existingSettings !== undefined || anyCycle > 0) {
        throw new AlreadyInitializedError();
      }
      await db.settings.put(settings);
      await db.liftState.bulkPut(liftStates);
      await db.tmEvents.bulkAdd(tmEvents);
      if (accessoryDefs.length > 0) await db.accessories.bulkAdd(accessoryDefs);
      await db.cycles.add(cycle);
      await db.workouts.bulkAdd(workouts);
    },
  );
}
