import type { Units } from '../../core/types.ts';

/**
 * Format a weight for display: trims trailing zeros so 147.5 → '147.5' and
 * 170 → '170' (never '170.0'). Kept unit-agnostic; callers append the unit.
 */
export function fmtWeight(weight: number): string {
  const rounded = Math.round(weight * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
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
