import { ROUTINE_MODES, type RoutineMode, type StretchSession } from '../../core/stretch/types.ts';

/** Days counted by {@link recentModeCounts}, today included. */
export const MODE_COUNT_DAYS = 30;

/** `YYYY-MM-DD` shifted by `days` (calendar arithmetic, no time zones). */
export function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/**
 * Sessions per routine type over the last {@link MODE_COUNT_DAYS} local days
 * (today included), in mode order, only types with at least one. Sessions
 * recorded before routine types existed count as 'focus'.
 */
export function recentModeCounts(
  sessions: readonly Pick<StretchSession, 'date' | 'mode'>[],
  today: string,
): { mode: RoutineMode; count: number }[] {
  const from = shiftIsoDate(today, -(MODE_COUNT_DAYS - 1));
  const counts = new Map<RoutineMode, number>();
  for (const s of sessions) {
    if (s.date < from || s.date > today) continue;
    const m = s.mode ?? 'focus';
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return ROUTINE_MODES.filter((m) => counts.has(m)).map((mode) => ({
    mode,
    count: counts.get(mode)!,
  }));
}
