import type { BodyweightEntry, Units } from '../../core/types.ts';
import { convertWeight } from '../../core/units.ts';
import { roundToIncrement } from '../../core/rounding.ts';

/** The bodyweight quick-log stepper step: whole pounds, half kilograms. */
export function bodyweightStep(units: Units): number {
  return units === 'lb' ? 1 : 0.5;
}

/** Starting value when no bodyweight has ever been logged. */
export function defaultBodyweight(units: Units): number {
  return units === 'lb' ? 180 : 82;
}

/**
 * The value the quick-log stepper opens at: the last entry converted from ITS
 * OWN units into `units`, rounded to the stepper step. Every entry carries its
 * own `units`, so a 180 lb entry seeds a kg stepper at 81.5, never at 180 — the
 * raw number would otherwise be saved as 180 kg on the next tap of Save.
 */
export function bodyweightSeed(last: BodyweightEntry | null, units: Units): number {
  if (last === null || !Number.isFinite(last.weight)) return defaultBodyweight(units);
  return roundToIncrement(convertWeight(last.weight, last.units, units), bodyweightStep(units));
}
