export type LiftId = 'press' | 'deadlift' | 'bench' | 'squat';
export type Units = 'lb' | 'kg';
export type WeekNumber = 1 | 2 | 3 | 4; // 4 = deload
export type WorkoutStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

/**
 * The lifts a StrongLifts 5×5 block can train: the four 5/3/1 lifts plus the
 * barbell row. NEVER widen {@link LiftId} itself — the 5/3/1 engine (TMs, TM
 * increments, day order, TM events) is deliberately 4-lift and the compiler
 * must keep rejecting `'row'` at those key sites.
 */
export type SlLiftId = LiftId | 'row';

/**
 * Program a cycle runs. ABSENT means classic 5/3/1 — the field is optional
 * precisely so every existing row and backup stays valid with no migration.
 */
export type ProgramId = 'sl5x5';

/** The alternating StrongLifts workouts: A = squat/bench/row, B = squat/press/deadlift. */
export type SlSlot = 'A' | 'B';

/** Per-lift mutable state of a StrongLifts block. */
export interface SlLiftRuntime {
  weight: number; // working weight for this lift's NEXT session
  increment: number; // lb: 5 (deadlift 10); kg: 2.5 (deadlift 5)
  failStreak: number; // 0..2; the 3rd consecutive fail triggers the deload
}

/** The StrongLifts runtime carried on an SL cycle. */
export interface SlCycleState {
  lifts: Record<SlLiftId, SlLiftRuntime>; // all 5, including 'row'
  keepPrs: boolean; // informational; the operative marker is Settings.prResets
}

export interface Settings {
  id: 'singleton';
  units: Units;
  roundingIncrement: number; // lb: 5 | 2.5 ; kg: 2.5 | 1.25
  tmPercent: number; // 0.85 | 0.90 (derive TM from 1RM inputs)
  includeDeload: boolean; // default for NEW cycles
  liftIncrements: Record<LiftId, number>; // lb: press 5, bench 5, squat 10, deadlift 10
  /**
   * User-chosen order the 4 lifts are trained within each week. OPTIONAL:
   * absent (older rows / older backups) means the classic DAY_ORDER default.
   * A present value must be a permutation of the 4 lifts; consumers pass it
   * through `normalizeDayOrder` before use so a malformed value falls back to
   * the default. Ordering is DERIVED at display/selection time — changing it
   * re-orders pending workouts instantly with no data migration.
   */
  dayOrder?: LiftId[];
  /**
   * Append-only ISO timestamps at which the PR slate was reset (a program
   * switch with "Keep PRs" OFF). OPTIONAL: absent (older rows / older backups)
   * means one unbroken record timeline. Never rewritten or reordered, so every
   * epoch stays reconstructible and pre-reset badges survive in History.
   */
  prResets?: string[];
  /**
   * A program switch armed from Settings, applied at the NEXT cycle completion.
   * OPTIONAL and cleared on confirm; absent means nothing is armed.
   */
  pendingProgramSwitch?: 'sl5x5' | 'five31';
  onboardingComplete: boolean;
  schemaVersion: number; // 1
}

export interface LiftState {
  liftId: LiftId;
  trainingMax: number;
} // current TM, authoritative

export interface Cycle {
  id: string;
  number: number; // 1-based, strictly increasing
  status: 'active' | 'completed';
  startedAt: string;
  completedAt?: string;
  tms: Record<LiftId, number>; // snapshot; changed only by mid-cycle override
  includeDeload: boolean;
  units: Units;
  /** ABSENT = classic 5/3/1 cycle. Present only on StrongLifts blocks. */
  program?: ProgramId;
  /** The StrongLifts runtime for this block. Present iff `program === 'sl5x5'`. */
  sl?: SlCycleState;
}

export interface MainSet {
  kind: 'warmup' | 'work';
  index: number;
  percent: number;
  weight: number; // computed+rounded, FROZEN at generation
  targetReps: number;
  amrap: boolean; // work set 2, weeks 1–3 only
  actualReps?: number;
  loggedAt?: string;
}

export interface AccessoryWork {
  // per-workout snapshot
  accessoryId: string;
  name: string; // snapshot — renames don't rewrite history
  weight: number; // stamped when workout starts
  targetSets: number;
  repRangeMin: number;
  repRangeMax: number;
  setReps: (number | null)[]; // length === targetSets
  progressed: boolean;
}

export interface Workout {
  id: string;
  cycleId: string;
  cycleNumber: number; // denormalized
  week: WeekNumber;
  /**
   * Widened to {@link SlLiftId} so StrongLifts rows can carry `'row'`. This is a
   * COMPILE-TIME widening only: classic 5/3/1 rows still only ever hold a
   * {@link LiftId}, and no stored data changes shape.
   */
  liftId: SlLiftId;
  status: WorkoutStatus;
  tmUsed: number; // FROZEN forever (SL: the session's working weight; 0 until stamped)
  mainSets: MainSet[]; // 3 warmup + 3 work (wk 1–3); 3 work (deload); SL: 5×5 work (DL 1×5)
  accessoryWork: AccessoryWork[];
  units: Units;
  startedAt?: string;
  completedAt?: string;
  notes?: string;
  editedAt?: string;
  /** ABSENT = classic 5/3/1 row. Present only on StrongLifts rows. */
  program?: ProgramId;
  /** 1-based session number within the SL block (1..12). SL rows only. */
  session?: number;
  /** Which alternating StrongLifts workout this row belongs to. SL rows only. */
  slSlot?: SlSlot;
}

export interface AccessoryDef {
  id: string;
  liftDayId: LiftId;
  name: string;
  sets: number;
  repRangeMin: number;
  repRangeMax: number;
  currentWeight: number; // weight for the NEXT session
  increment: number; // default 5 lb / 2.5 kg
  order: number;
  createdAt: string;
  archivedAt?: string; // soft delete
}

export interface BodyweightEntry {
  id: string;
  date: string;
  weight: number;
  units: Units;
}

export interface TmEvent {
  // append-only TM audit log
  id: string;
  liftId: LiftId;
  cycleId: string | null;
  timestamp: string;
  type: 'initial' | 'cycle_advance' | 'manual_override' | 'unit_conversion';
  fromValue: number | null;
  toValue: number;
  note?: string;
}

export interface BackupFile {
  app: 'five31';
  schemaVersion: number;
  exportedAt: string;
  data: {
    settings: Settings[];
    liftState: LiftState[];
    cycles: Cycle[];
    workouts: Workout[];
    accessories: AccessoryDef[];
    bodyweight: BodyweightEntry[];
    tmEvents: TmEvent[];
  };
}
