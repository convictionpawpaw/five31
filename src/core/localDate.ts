/**
 * Local calendar-day helpers. Pure.
 *
 * A "day" everywhere in FIVE31 (bodyweight entries, stretch streaks) is the
 * user's LOCAL calendar date as `YYYY-MM-DD`, built from the local
 * getFullYear/getMonth/getDate. Never derive it from `toISOString()`, which is
 * UTC and would roll the day over at the wrong hour for anyone west or east of
 * Greenwich.
 */

/** The local calendar date of `date` (default: now) as `YYYY-MM-DD`, e.g. '2026-07-05'. */
export function localIsoDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
