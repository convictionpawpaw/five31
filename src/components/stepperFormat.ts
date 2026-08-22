/**
 * Display formatting for {@link NumberStepper}. Pure and DOM-free so it can be
 * unit-tested directly — the stepper itself only wires it to `value`.
 */

/**
 * Number of decimal places a step implies, so the displayed value never rounds
 * away a committed fraction (step 2.5 → 1; step 1.25 → 2; integer step → 0).
 * Capped at 3 to match the stepper's `normalize` precision.
 */
export function decimalsForStep(step: number): number {
  if (Number.isInteger(step)) return 0;
  const s = String(step);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : Math.min(3, s.length - dot - 1);
}

/**
 * Render a stepper value so the DISPLAY equals the COMMITTED value with no
 * noise. `dp` (from {@link decimalsForStep}) is the ceiling on precision, not a
 * demand for it: the value is fixed to `dp` places and any trailing zeros in the
 * fraction are then trimmed off the string, dropping the point entirely when
 * nothing meaningful is left.
 *
 *   (125, 1)   → '125'      not '125.0'
 *   (92.5, 1)  → '92.5'     a committed fraction always survives
 *   (92.5, 2)  → '92.5'     the padding zero is noise, not precision
 *   (61.25, 2) → '61.25'    kg 1.25-step fractions are kept in full
 *   (285, 0)   → '285'
 *
 * Deliberately string trimming rather than `parseFloat` round-tripping: the
 * fixed string is already the authority on precision, and re-parsing it invites
 * exactly the binary-float drift `toFixed` was called to remove.
 */
export function formatStepperValue(value: number, dp: number): string {
  const fixed = value.toFixed(dp);
  const dot = fixed.indexOf('.');
  if (dot === -1) return fixed;
  let end = fixed.length;
  while (end > dot + 1 && fixed[end - 1] === '0') end -= 1;
  return end === dot + 1 ? fixed.slice(0, dot) : fixed.slice(0, end);
}
