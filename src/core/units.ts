import type { LiftId, Units } from './types.ts';

/** Exact pounds-per-kilogram conversion factor (1 lb = 0.45359237 kg). */
export const LB_PER_KG = 0.45359237;

/** Convert a raw weight between units. lb → kg multiplies by LB_PER_KG; kg → lb divides. */
export function convertWeight(weight: number, from: Units, to: Units): number {
  if (from === to) return weight;
  if (from === 'lb' && to === 'kg') return weight * LB_PER_KG;
  // from === 'kg' && to === 'lb'
  return weight / LB_PER_KG;
}

/** Default rounding increment for a unit (the finer of the two common choices). */
export function defaultRoundingIncrement(units: Units): number {
  return units === 'lb' ? 5 : 2.5;
}

/** The two rounding increments a user may pick for a given unit. */
export function roundingIncrementOptions(units: Units): [number, number] {
  return units === 'lb' ? [5, 2.5] : [2.5, 1.25];
}

/** Default per-lift TM increment for a unit: press/bench small, squat/deadlift large. */
export function defaultLiftIncrements(units: Units): Record<LiftId, number> {
  if (units === 'lb') {
    return { press: 5, bench: 5, squat: 10, deadlift: 10 };
  }
  // kg: half the lb increments.
  return { press: 2.5, bench: 2.5, squat: 5, deadlift: 5 };
}

/** Default accessory weight increment for a unit. */
export function defaultAccessoryIncrement(units: Units): number {
  return units === 'lb' ? 5 : 2.5;
}
