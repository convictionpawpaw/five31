/**
 * Strict daily stretch streak. Pure.
 *
 * Days are LOCAL calendar dates as `YYYY-MM-DD` strings (see core/localDate).
 * Day arithmetic here parses those strings into UTC midnights and steps in
 * whole UTC days, which has no DST and so never skips or repeats a calendar
 * day. Nothing here reads the clock: the caller passes `today`.
 *
 * STRICT: any missed calendar day resets the streak. No freezes, no grace,
 * except that a streak which ended yesterday is still shown as current (and
 * "at risk") until today is over, because today can still extend it.
 */

const DAY_MS = 86_400_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Minimal session shape the streak needs. */
export interface StreakSessionLike {
  /** Local day, `YYYY-MM-DD`. */
  date: string;
  /** Seconds actually stretched. */
  actualSec: number;
}

export interface StreakDay {
  date: string;
  /** Sessions logged that day. */
  count: number;
  isToday: boolean;
  isFuture: boolean;
}

export interface StreakSummary {
  /** Consecutive days ending today, or ending yesterday if today is not done yet. */
  current: number;
  /** True when today is not done but yesterday was (the streak ends tonight). */
  atRisk: boolean;
  longest: number;
  doneToday: boolean;
  totalSessions: number;
  /** Total stretching time, rounded to whole minutes. */
  totalMinutes: number;
  /** Sessions in the current Monday-to-Sunday week. */
  sessionsThisWeek: number;
  /** 35 days (5 weeks), Monday-first rows, ending with the current week's Sunday. */
  calendar: StreakDay[];
}

/** Parse `YYYY-MM-DD` to a UTC-midnight day number, or null if malformed. */
export function dayNumber(iso: string): number | null {
  const m = ISO_DAY.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // Reject impossible dates like 2026-02-30.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return Math.round(ms / DAY_MS);
}

/** Format a UTC-midnight day number back to `YYYY-MM-DD`. */
export function dayString(n: number): string {
  const dt = new Date(n * DAY_MS);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** `iso` shifted by `delta` calendar days. */
export function addDays(iso: string, delta: number): string {
  const n = dayNumber(iso);
  if (n === null) throw new Error(`Invalid day '${iso}'`);
  return dayString(n + delta);
}

/** Weekday of a day number, Monday = 0 … Sunday = 6. */
function mondayIndex(n: number): number {
  // Day 0 (1970-01-01) was a Thursday (Monday-index 3).
  return (((n + 3) % 7) + 7) % 7;
}

/** Compute the streak summary for `sessions` as of local day `today`. */
export function computeStreak(
  sessions: readonly StreakSessionLike[],
  today: string,
): StreakSummary {
  const todayN = dayNumber(today);
  if (todayN === null) throw new Error(`Invalid today '${today}'`);

  const counts = new Map<number, number>();
  let totalSec = 0;
  let totalSessions = 0;
  for (const s of sessions) {
    const n = dayNumber(s.date);
    // Malformed dates are ignored; so are sessions dated after today (clock
    // skew or a bad import) so they can neither extend nor fake a streak.
    if (n === null || n > todayN) continue;
    counts.set(n, (counts.get(n) ?? 0) + 1);
    // Non-finite or negative durations (corrupt rows) count as zero.
    totalSec += Number.isFinite(s.actualSec) ? Math.max(0, s.actualSec) : 0;
    totalSessions++;
  }

  const doneToday = counts.has(todayN);
  let current = 0;
  let cursor = doneToday ? todayN : todayN - 1;
  while (counts.has(cursor)) {
    current++;
    cursor--;
  }
  const atRisk = !doneToday && current > 0;

  const days = [...counts.keys()].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i]! === days[i - 1]! + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const weekStart = todayN - mondayIndex(todayN);
  let sessionsThisWeek = 0;
  for (let n = weekStart; n <= todayN; n++) sessionsThisWeek += counts.get(n) ?? 0;

  const calendarStart = weekStart - 28;
  const calendar: StreakDay[] = [];
  for (let n = calendarStart; n < calendarStart + 35; n++) {
    calendar.push({
      date: dayString(n),
      count: counts.get(n) ?? 0,
      isToday: n === todayN,
      isFuture: n > todayN,
    });
  }

  return {
    current,
    atRisk,
    longest,
    doneToday,
    totalSessions,
    totalMinutes: Math.round(totalSec / 60),
    sessionsThisWeek,
    calendar,
  };
}
