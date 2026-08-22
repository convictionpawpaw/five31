import type { SlLiftId, SlSlot } from '../../core/types.ts';

/**
 * Full uppercase display name for a lift. Keyed by {@link SlLiftId} so the
 * StrongLifts row has a label too; every 5/3/1 caller passes a {@link LiftId},
 * which is a subset, so those lookups are unchanged.
 */
export const LIFT_NAMES: Record<SlLiftId, string> = {
  press: 'PRESS',
  deadlift: 'DEADLIFT',
  bench: 'BENCH',
  squat: 'SQUAT',
  row: 'ROW',
};

/** Short column glyph for the cycle grid header (P / DL / B / SQ / R). */
export const LIFT_ABBR: Record<SlLiftId, string> = {
  press: 'P',
  deadlift: 'DL',
  bench: 'B',
  squat: 'SQ',
  row: 'R',
};

/** Human label for a week number ('WEEK 1'..'WEEK 3', 'DELOAD' for 4). */
export function weekLabel(week: number): string {
  return week === 4 ? 'DELOAD' : `WEEK ${week}`;
}

/** Zero-padded cycle number, e.g. 1 → '01', 12 → '12'. */
export function cycleTag(n: number): string {
  return String(n).padStart(2, '0');
}

/** StrongLifts session tag, e.g. (5, 'A') → 'S05 · A'. */
export function sessionLabel(n: number, slot: SlSlot): string {
  return `S${String(n).padStart(2, '0')} · ${slot}`;
}

/**
 * A StrongLifts week label. Deliberately NOT {@link weekLabel}: sessions 10–12
 * carry `week === 4`, which is an ordinary fourth week of the block and must
 * never be rendered as 'DELOAD' (the week-4 footgun).
 */
export function slWeekLabel(week: number): string {
  return `WEEK ${week}`;
}

/**
 * The LONG form of {@link sessionLabel} for a screen header, e.g.
 * (5, 'A', 2) → 'SESSION 05 · A · WEEK 2'. The compact tag is used where space
 * is tight (history clusters); this one titles the session screen.
 */
export function slSessionHeading(n: number, slot: SlSlot, week: number): string {
  return `SESSION ${String(n).padStart(2, '0')} · ${slot} · ${slWeekLabel(week)}`;
}
