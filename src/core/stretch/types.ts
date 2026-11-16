/**
 * Stretch feature — shared types. Pure; no imports outside src/core/stretch.
 */

/** The body areas a routine can target. Order here is the canonical display order. */
export type BodyArea =
  | 'neck'
  | 'upperBack'
  | 'lowerBack'
  | 'chest'
  | 'shoulders'
  | 'hips'
  | 'glutes'
  | 'hamstrings'
  | 'quads'
  | 'calves'
  | 'wristsForearms';

/** Every body area in canonical order. */
export const BODY_AREAS: readonly BodyArea[] = [
  'neck',
  'upperBack',
  'lowerBack',
  'chest',
  'shoulders',
  'hips',
  'glutes',
  'hamstrings',
  'quads',
  'calves',
  'wristsForearms',
];

/** Human labels for chips and lists. */
export const BODY_AREA_LABELS: Record<BodyArea, string> = {
  neck: 'Neck',
  upperBack: 'Upper back',
  lowerBack: 'Lower back',
  chest: 'Chest',
  shoulders: 'Shoulders',
  hips: 'Hips',
  glutes: 'Glutes',
  hamstrings: 'Hamstrings',
  quads: 'Quads',
  calves: 'Calves',
  wristsForearms: 'Wrists',
};

/** Type guard for values read back from storage or backups. */
export function isBodyArea(value: unknown): value is BodyArea {
  return typeof value === 'string' && (BODY_AREAS as readonly string[]).includes(value);
}

/**
 * Body position a stretch is done in. Routines are ordered standing → seated
 * (chair) → kneeling → floor so the user changes position as few times as
 * possible. Stretches seated ON the floor count as 'floor'.
 */
export type StretchPosition = 'standing' | 'seated' | 'kneeling' | 'floor';

/** Position order used by the generator. */
export const POSITION_ORDER: readonly StretchPosition[] = [
  'standing',
  'seated',
  'kneeling',
  'floor',
];

/**
 * How the body lies for a 'floor' stretch. Within the floor block routines
 * are grouped sitting → lying on the back → on the side → face down, the
 * natural order for getting down from kneeling and rolling over, so the user
 * changes posture as few times as possible.
 */
export type FloorPosture = 'sitting' | 'supine' | 'sideLying' | 'prone';

/** Posture order used by the generator inside the floor block. */
export const FLOOR_POSTURE_ORDER: readonly FloorPosture[] = [
  'sitting',
  'supine',
  'sideLying',
  'prone',
];

/** One stretch in the library. */
export interface Stretch {
  /** Stable kebab-case id; persisted in sessions, never renamed. */
  id: string;
  name: string;
  /** Areas worked, primary first. */
  areas: BodyArea[];
  position: StretchPosition;
  /** Floor stretches only: how the body lies (orders the floor block). */
  posture?: FloorPosture;
  /** True when it is done once per side (left step then right step). */
  bilateral: boolean;
  /** Default hold in seconds (per side for bilateral stretches). */
  holdSec: number;
  /** Two or three short coaching lines. */
  cues: string[];
  /** Key into POSES for the illustration. */
  pose: string;
  /**
   * A movement that is already a set of repetitions (e.g. cat-cow). Never
   * repeated as a block: it always stays one step.
   */
  continuous?: true;
}

export type Side = 'left' | 'right';

/** How many times each stretch is done, back to back. */
export type Reps = 1 | 2 | 3;

/**
 * One timed step of a routine. A bilateral stretch yields two steps per rep
 * (left, right), and all reps of a stretch are adjacent: L, R, L, R.
 */
export interface RoutineStep {
  stretchId: string;
  side?: Side;
  holdSec: number;
  /** 1-based rep number; absent for a stretch done once. */
  rep?: number;
  /** How many reps this stretch gets; absent (or 1) for a stretch done once. */
  repOf?: number;
}

/** A generated routine. */
export interface Routine {
  /** Target length in whole minutes (5 to 10). */
  minutes: number;
  /** Focus areas it was built for; empty means well-rounded. */
  focusAreas: BodyArea[];
  seed: number;
  /**
   * Reps requested (most stretches get this many; some get fewer when time
   * is short, continuous ones always one). Optional only so routines made
   * before reps existed still type-check; absent means 1.
   */
  reps?: Reps;
  steps: RoutineStep[];
  /** Planned length in seconds: holds plus one transition per step. */
  totalSec: number;
  /**
   * Focus areas that got no stretch because the time was too short to fit
   * one stretch per area (canonical order; empty when none). Only happens
   * with many focus areas at short lengths. Optional so routines saved
   * before this field existed still type-check.
   */
  droppedAreas?: BodyArea[];
}

/** A completed (or substantially completed) stretch session, as persisted. */
export interface StretchSession {
  /** ULID. */
  id: string;
  /** LOCAL calendar day the session was started, `YYYY-MM-DD`. Drives the streak. */
  date: string;
  /** Epoch ms. */
  startedAt: number;
  /** Epoch ms. */
  completedAt: number;
  /** The routine's planned length in seconds. */
  plannedSec: number;
  /** Seconds actually spent stretching (excludes paused time and skipped holds). */
  actualSec: number;
  /** The routine length the user picked, in minutes (5 to 10). */
  minutes: number;
  focusAreas: BodyArea[];
  /** Unique stretch ids in the order performed. */
  stretchIds: string[];
}

/** A routine the user saved by name; replays exactly as saved. */
export interface SavedRoutine {
  /** ULID. */
  id: string;
  /** Trimmed, 1 to 40 characters; duplicates allowed. */
  name: string;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms; changes on rename. */
  updatedAt: number;
  /** The full routine snapshot (steps and holds), played back verbatim. */
  routine: Routine;
}
