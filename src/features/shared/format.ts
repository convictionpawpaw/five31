import type { Units } from '../../core/types.ts';

/**
 * Format a weight for display: trims trailing zeros so 147.5 → '147.5' and
 * 170 → '170' (never '170.0'). Kept unit-agnostic; callers append the unit.
 */
export function fmtWeight(weight: number): string {
  const rounded = Math.round(weight * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/**
 * A weight that may not exist — a StrongLifts session skipped before it was ever
 * started has none. Renders the em-dash placeholder rather than substituting a
 * live or projected number, which in a resolved slot would read as history.
 */
export function fmtWeightOrDash(weight: number | null): string {
  return weight === null ? '—' : fmtWeight(weight);
}

/** Weight with its unit suffix, e.g. '170 LB' / '82.5 KG'. */
export function fmtWeightUnit(weight: number, units: Units): string {
  return `${fmtWeight(weight)} ${units.toUpperCase()}`;
}

/**
 * Target-reps label for a set: '5', or '5+' for an AMRAP set. Mirrors the
 * classic 5/3/1 "5+/3+/1+" notation.
 */
export function fmtTargetReps(reps: number, amrap: boolean): string {
  return amrap ? `${reps}+` : String(reps);
}

const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse an ISO string for DISPLAY. A date-only string ('2026-07-01', the shape
 * bodyweight entries are keyed by) is a LOCAL calendar date: `new Date()` would
 * read it as UTC midnight, which is the previous evening anywhere west of UTC,
 * so every bodyweight label rendered one day early. Full timestamps keep the
 * standard parse (an instant, shown in local time).
 */
export function parseIsoForDisplay(iso: string): Date {
  const m = DATE_ONLY.exec(iso);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(iso);
}

/**
 * Compact uppercase date from an ISO string/date, e.g. '2026-07-05' → 'JUL 5'.
 * Falls back to the raw first 10 chars if the string doesn't parse.
 */
export function fmtShortDate(iso: string): string {
  const d = parseIsoForDisplay(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Month + year for a cycle header, e.g. '2026-07-05' → 'JUL 2026'. */
export function fmtMonthYear(iso: string): string {
  const d = parseIsoForDisplay(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 7);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
