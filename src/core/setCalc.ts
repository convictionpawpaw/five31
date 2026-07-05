import type { MainSet, WeekNumber } from './types.ts';
import { WARMUP, WEEK_SCHEMES, weekHasAmrap, weekHasWarmups } from './scheme.ts';
import { roundToIncrement } from './rounding.ts';

/**
 * Build the full list of main sets (warmups + work) for a single workout, with
 * every weight computed from the Training Max, rounded, and FROZEN.
 *
 * Weeks 1–3: 3 warmups (40/50/60% × 5/5/3) + 3 work sets; the last work set is
 * the AMRAP ("+") set. Week 4 (deload): 3 work sets only (40/50/60% × 5), no
 * warmups and no AMRAP.
 *
 * `index` restarts at 0 for warmups and 0 for work sets (kind-scoped).
 */
export function buildMainSets(tm: number, week: WeekNumber, inc: number): MainSet[] {
  const sets: MainSet[] = [];

  if (weekHasWarmups(week)) {
    WARMUP.forEach((s, i) => {
      sets.push({
        kind: 'warmup',
        index: i,
        percent: s.percent,
        weight: roundToIncrement(tm * s.percent, inc),
        targetReps: s.reps,
        amrap: false,
      });
    });
  }

  const workScheme = WEEK_SCHEMES[week];
  const amrapWeek = weekHasAmrap(week);
  const lastWorkIndex = workScheme.length - 1;

  workScheme.forEach((s, i) => {
    sets.push({
      kind: 'work',
      index: i,
      percent: s.percent,
      weight: roundToIncrement(tm * s.percent, inc),
      targetReps: s.reps,
      amrap: amrapWeek && i === lastWorkIndex,
    });
  });

  return sets;
}
