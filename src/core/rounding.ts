/**
 * Round a weight to the nearest multiple of `increment`.
 *
 * Rules:
 *  - Nearest multiple wins.
 *  - Ties round UP (half-up), e.g. exactly 2.5 away rounds to the higher multiple.
 *  - A ×100 integer guard eliminates binary float drift (e.g. 146.25 / 2.5).
 *
 * Golden vectors:
 *   (138.75, 5)   -> 140
 *   (157.25, 5)   -> 155
 *   (146.25, 2.5) -> 147.5
 *   (0, 5)        -> 0
 */
export function roundToIncrement(weight: number, increment: number): number {
  if (increment <= 0) return weight;

  // Work in integer "centis" to avoid float representation error.
  const w = Math.round(weight * 100);
  const inc = Math.round(increment * 100);

  // Half-up: add half the increment, then floor to the increment.
  const rounded = Math.floor((w + inc / 2) / inc) * inc;

  return rounded / 100;
}
