import type { MainSet, Workout } from './types.ts';
import { epley } from './e1rm.ts';

/**
 * The set of a workout that counts as its PR EFFORT — the one whose e1RM feeds
 * the record timeline, the PR badge and the e1RM chart. Program-aware:
 *
 *  - 5/3/1 (`program` absent): the AMRAP work set, exactly as before. Returned
 *    whether or not it has been logged; callers check `actualReps` themselves.
 *    This branch is byte-compatible with the classic `amrapSet` extraction.
 *  - StrongLifts (`program === 'sl5x5'`): there is no AMRAP, so the effort is
 *    the LOGGED work set with the highest e1RM. Ties keep the FIRST such set
 *    (earliest index). Sets with no valid e1RM (unlogged, or 0/negative reps)
 *    are never candidates; if none qualify the workout has no effort → null.
 */
export function effortSet(w: Workout): MainSet | null {
  if (w.program === 'sl5x5') return bestLoggedWorkSet(w.mainSets);
  return w.mainSets.find((s) => s.kind === 'work' && s.amrap) ?? null;
}

/** The logged work set with the highest e1RM; ties resolve to the earliest index. */
function bestLoggedWorkSet(sets: readonly MainSet[]): MainSet | null {
  let best: MainSet | null = null;
  let bestE1rm = -Infinity;
  for (const s of sets) {
    if (s.kind !== 'work') continue;
    if (s.actualReps === undefined) continue;
    const e1 = epley(s.weight, s.actualReps);
    if (e1 === null) continue;
    if (e1 > bestE1rm) {
      // strict > ⇒ first of a tie wins
      best = s;
      bestE1rm = e1;
    }
  }
  return best;
}
