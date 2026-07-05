export type LiftId = 'press' | 'deadlift' | 'bench' | 'squat';
export type Units = 'lb' | 'kg';
export type WeekNumber = 1 | 2 | 3 | 4; // 4 = deload
export type WorkoutStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export interface Settings {
  id: 'singleton';
  units: Units;
  roundingIncrement: number; // lb: 5 | 2.5 ; kg: 2.5 | 1.25
  tmPercent: number; // 0.85 | 0.90 (derive TM from 1RM inputs)
  includeDeload: boolean; // default for NEW cycles
  liftIncrements: Record<LiftId, number>; // lb: press 5, bench 5, squat 10, deadlift 10
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
  liftId: LiftId;
  status: WorkoutStatus;
  tmUsed: number; // FROZEN forever
  mainSets: MainSet[]; // 3 warmup + 3 work (wk 1–3); 3 work (deload)
  accessoryWork: AccessoryWork[];
  units: Units;
  startedAt?: string;
  completedAt?: string;
  notes?: string;
  editedAt?: string;
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
