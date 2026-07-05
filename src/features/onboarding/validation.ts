import type { OnboardingState } from './onboardingState.ts';
import { LIFTS, resolveTm } from './onboardingState.ts';

/**
 * Whether the TM step is valid: every lift resolves to a Training Max > 0.
 * (A direct TM of 0, or a 1RM of 0, both fail.)
 */
export function isTmStepValid(state: OnboardingState): boolean {
  return LIFTS.every((lift) => {
    const tm = resolveTm(state.tmEntries[lift], state.tmPercent, state.roundingIncrement);
    return tm > 0;
  });
}

/** Increments step: every per-lift TM bump must be > 0. */
export function isIncrementsStepValid(state: OnboardingState): boolean {
  return LIFTS.every((lift) => state.liftIncrements[lift] > 0);
}

/**
 * Accessories step: optional overall, but any row the user *named* must be
 * fully valid — sets ≥ 1, 0 < repMin < repMax, weight ≥ 0, increment > 0.
 * Blank (unnamed) rows are ignored (they'll be dropped on submit).
 */
export function isAccessoriesStepValid(state: OnboardingState): boolean {
  return state.accessories.every((a) => {
    if (a.name.trim().length === 0) return true; // blank row — skipped
    if (a.sets < 1) return false;
    if (a.repRangeMin < 1) return false;
    if (a.repRangeMin >= a.repRangeMax) return false;
    if (a.currentWeight < 0) return false;
    if (a.increment <= 0) return false;
    return true;
  });
}

/** Whether the given step index (0-based) is complete enough to advance. */
export function isStepValid(step: number, state: OnboardingState): boolean {
  switch (step) {
    case 0: // Units + rounding — always has valid defaults
      return state.roundingIncrement > 0;
    case 1: // Training Maxes
      return isTmStepValid(state);
    case 2: // Increments
      return isIncrementsStepValid(state);
    case 3: // Deload — a boolean, always valid
      return true;
    case 4: // Accessories — optional/skippable
      return isAccessoriesStepValid(state);
    case 5: // Review — valid iff everything upstream is
      return (
        isTmStepValid(state) && isIncrementsStepValid(state) && isAccessoriesStepValid(state)
      );
    default:
      return false;
  }
}
