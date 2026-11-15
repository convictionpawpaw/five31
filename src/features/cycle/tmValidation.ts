import type { LiftId } from '../../core/types.ts';

/** Inline copy shown under a training-max stepper that would commit an unusable TM. */
export const TM_REQUIRED_COPY = 'Training max must be greater than zero.';

/** A training max the program can run on: a finite number above zero. */
export function isValidTm(tm: number | undefined): boolean {
  return tm !== undefined && Number.isFinite(tm) && tm > 0;
}

/** The lifts whose TM in `tms` is not valid (missing, non-finite, or ≤ 0). */
export function invalidTmLifts(
  tms: Partial<Record<LiftId, number>>,
  lifts: readonly LiftId[],
): LiftId[] {
  return lifts.filter((liftId) => !isValidTm(tms[liftId]));
}
