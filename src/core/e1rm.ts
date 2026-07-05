/**
 * Estimated 1-rep max via the Epley formula: `w × (1 + reps/30)`.
 *
 * - reps === 1 → returns the weight unchanged.
 * - reps <= 0 → null (no meaningful estimate from zero/negative reps).
 *
 * The result is rounded to one decimal place. Golden: epley(200, 5) → 233.3.
 */
export function epley(weight: number, reps: number): number | null {
  if (reps <= 0) return null;
  if (reps === 1) return weight; // a single rep IS the (estimated) 1RM
  const raw = weight * (1 + reps / 30);
  return Math.round(raw * 10) / 10;
}
