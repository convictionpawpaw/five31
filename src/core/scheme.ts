import type { LiftId, WeekNumber } from './types.ts';

/** Canonical order lifts are trained within a week. */
export const DAY_ORDER: readonly LiftId[] = ['press', 'deadlift', 'bench', 'squat'] as const;

/** A single prescribed set as a fraction of the Training Max, plus target reps. */
export interface SchemeSet {
  percent: number; // fraction of TM (0..1)
  reps: number;
}

/** Warmup ramp — same for every main week (weeks 1–3). Deload has no warmups. */
export const WARMUP: readonly SchemeSet[] = [
  { percent: 0.4, reps: 5 },
  { percent: 0.5, reps: 5 },
  { percent: 0.6, reps: 3 },
] as const;

/**
 * The three work sets for each main week. The final work set of weeks 1–3 is
 * the AMRAP ("+") set; the deload week has no AMRAP.
 */
export const WEEK_SCHEMES: Record<WeekNumber, readonly SchemeSet[]> = {
  1: [
    { percent: 0.65, reps: 5 },
    { percent: 0.75, reps: 5 },
    { percent: 0.85, reps: 5 }, // 5+
  ],
  2: [
    { percent: 0.7, reps: 3 },
    { percent: 0.8, reps: 3 },
    { percent: 0.9, reps: 3 }, // 3+
  ],
  3: [
    { percent: 0.75, reps: 5 },
    { percent: 0.85, reps: 3 },
    { percent: 0.95, reps: 1 }, // 1+
  ],
  4: [
    { percent: 0.4, reps: 5 },
    { percent: 0.5, reps: 5 },
    { percent: 0.6, reps: 5 }, // deload — no AMRAP
  ],
} as const;

/** Whether a given week has warmup sets (weeks 1–3 do; deload does not). */
export function weekHasWarmups(week: WeekNumber): boolean {
  return week !== 4;
}

/** Whether a given week's final work set is an AMRAP set (weeks 1–3 do; deload does not). */
export function weekHasAmrap(week: WeekNumber): boolean {
  return week !== 4;
}
