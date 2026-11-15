import type { StreakSummary } from '../../core/stretch/streak.ts';

/** Seconds as m:ss, e.g. 425 → '7:05'. */
export function fmtClock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** One-line state of today's streak, with a tone for styling. */
export function streakStatus(s: StreakSummary): { text: string; tone: 'done' | 'risk' | 'idle' } {
  if (s.doneToday) return { text: 'Done today', tone: 'done' };
  if (s.atRisk) return { text: 'Not yet today: stretch to keep it', tone: 'risk' };
  return {
    text: s.longest > 0 ? 'Start a new streak today' : 'Start your streak today',
    tone: 'idle',
  };
}
