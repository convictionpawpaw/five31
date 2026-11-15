/**
 * Integer grid the inputs are snapped to before rounding: one millionth of a
 * unit. Every weight the app produces (a TM on any sane grid × a two-decimal
 * percentage, a unit conversion, an increment) is either exactly on this grid
 * or within float noise of it, and 600 kg × 1e6 × 2 stays far below 2^53.
 */
const SCALE = 1_000_000;

/**
 * Round a weight to the nearest multiple of `increment`.
 *
 * Rules:
 *  - Nearest multiple wins.
 *  - Ties round UP (half-up), e.g. exactly 2.5 away rounds to the higher multiple.
 *  - Inputs are snapped to a 1e-6 integer grid first, which absorbs binary float
 *    drift in BOTH directions. The previous ×100 guard snapped to centis with
 *    `Math.round(weight * 100)`, so a product such as 81.25 × 0.70 (exactly
 *    56.875, but 56.87499999… in binary) landed on 5687 rather than the
 *    half-centi 5687.5 and a true tie rounded DOWN (56.25 instead of 57.5). The
 *    same snap also stopped sub-centi values just under a tie from being pushed
 *    up onto it: the comparison is now against the exact midpoint.
 *
 * Callers routinely pass an already-multiplied float (tm × percent, a
 * converted weight × factor); the 1e-6 snap is what makes that safe.
 *
 * Golden vectors:
 *   (138.75, 5)   -> 140
 *   (157.25, 5)   -> 155
 *   (146.25, 2.5) -> 147.5
 *   (0, 5)        -> 0
 */
export function roundToIncrement(weight: number, increment: number): number {
  if (increment <= 0) return weight;

  const w = Math.round(weight * SCALE);
  const inc = Math.round(increment * SCALE);
  if (inc <= 0) return weight;

  // Half-up in pure integer arithmetic: floor((w + inc/2) / inc), written as
  // floor((2w + inc) / 2inc) so no fractional half-increment ever appears.
  const q = Math.floor((2 * w + inc) / (2 * inc));
  return (q * inc) / SCALE;
}
