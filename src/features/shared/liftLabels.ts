import type { LiftId } from '../../core/types.ts';

/** Full uppercase display name for a lift. */
export const LIFT_NAMES: Record<LiftId, string> = {
  press: 'PRESS',
  deadlift: 'DEADLIFT',
  bench: 'BENCH',
  squat: 'SQUAT',
};

/** Short column glyph for the cycle grid header (P / DL / B / SQ). */
export const LIFT_ABBR: Record<LiftId, string> = {
  press: 'P',
  deadlift: 'DL',
  bench: 'B',
  squat: 'SQ',
};

/** Human label for a week number ('WEEK 1'..'WEEK 3', 'DELOAD' for 4). */
export function weekLabel(week: number): string {
  return week === 4 ? 'DELOAD' : `WEEK ${week}`;
}

/** Zero-padded cycle number, e.g. 1 → '01', 12 → '12'. */
export function cycleTag(n: number): string {
  return String(n).padStart(2, '0');
}
