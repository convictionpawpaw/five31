import type { MainSet, Units, WeekNumber } from './types.ts';
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

/** A standard empty barbell: 45 lb / 20 kg. */
export function barWeight(units: Units): number {
  return units === 'lb' ? 45 : 20;
}

/**
 * Whether a computed set weight is lighter than the empty bar. Purely a DISPLAY
 * hint: {@link buildMainSets} deliberately does not floor at the bar (a low TM,
 * e.g. a 60 lb press, yields 25/30/35 lb warmups), and changing frozen weights
 * here would rewrite program math. The workout screen uses this to say so.
 */
export function isBelowBar(weight: number, units: Units): boolean {
  return weight < barWeight(units);
}
