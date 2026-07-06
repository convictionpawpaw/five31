import type { LiftId, WeekNumber } from './types.ts';

/** Canonical (default) order lifts are trained within a week. */
export const DAY_ORDER: readonly LiftId[] = ['press', 'deadlift', 'bench', 'squat'] as const;

/**
 * Validate a user-supplied training-day order. Returns `order` unchanged iff it
 * is a valid permutation of the four canonical lifts (right length, no
 * duplicates, no unknown ids); otherwise — including `undefined` — returns the
 * canonical {@link DAY_ORDER}. Pure: never mutates its input.
 *
 * This is the single gate every ordering consumer routes a stored `dayOrder`
 * through, so an absent or malformed value always degrades to the classic order.
 */
export function normalizeDayOrder(order: readonly LiftId[] | undefined): readonly LiftId[] {
  if (order === undefined || order.length !== DAY_ORDER.length) return DAY_ORDER;
  const seen = new Set<LiftId>();
  for (const liftId of order) {
    if (!DAY_ORDER.includes(liftId)) return DAY_ORDER; // unknown id
    if (seen.has(liftId)) return DAY_ORDER; // duplicate
    seen.add(liftId);
  }
  return order;
}

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
