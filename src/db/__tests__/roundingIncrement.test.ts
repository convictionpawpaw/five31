// Regression suite for the C2.1 audit fix: generated SET WEIGHTS must round to
// Settings.roundingIncrement — the per-lift TM increments (5/5/10/10 lb) are
// progression bumps ONLY and must never be used as weight-rounding increments.
// Canary vector: squat TM 265, week-1 top set 265 × 0.85 = 225.25 → 225 at
// rounding 5 (the old bug rounded to the squat TM increment 10 → 230).
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, lbOnboardingPayload } from './setup.ts';
import { initializeFromOnboarding } from '../repo/onboardingRepo.ts';
import {
  addDeloadToActiveCycle,
  completeCycle,
  getActiveCycle,
  getCycleWorkouts,
} from '../repo/cycleRepo.ts';
import { applyTmOverride } from '../repo/tmOverrideRepo.ts';
import type { LiftId } from '../../core/types.ts';

beforeEach(resetDb);

const CANARY_TMS: Record<LiftId, number> = {
  press: 120,
  bench: 200,
  squat: 265, // 265 × 0.85 = 225.25 → 225 @ rounding 5; 230 under the old bug
  deadlift: 350,
};

/** True iff `weight` is an exact multiple of `inc` (float-safe via ×100). */
function isMultipleOf(weight: number, inc: number): boolean {
  return Math.round(weight * 100) % Math.round(inc * 100) === 0;
}

describe('set weights round to Settings.roundingIncrement, not lift TM increments', () => {
  it('(a) onboarding: squat TM 265 @ rounding 5 → week-1 top set exactly 225, not 230', async () => {
    await initializeFromOnboarding(
      lbOnboardingPayload({ roundingIncrement: 5, trainingMaxes: CANARY_TMS }),
    );
    const cycle = await getActiveCycle();
    const squatWk1 = (await getCycleWorkouts(cycle!.id)).find(
      (w) => w.liftId === 'squat' && w.week === 1,
    )!;
    const work = squatWk1.mainSets.filter((s) => s.kind === 'work');
    // 265 × 0.65/0.75/0.85 = 172.25/198.75/225.25 → 170/200/225 @ rounding 5.
    expect(work.map((s) => s.weight)).toEqual([170, 200, 225]);
    expect(work[2]!.weight).toBe(225); // NOT 230 (old 10-lb-rounding bug)

    // Warmups too: 265 × 0.4/0.5/0.6 = 106/132.5/159 → 105/135/160.
    const warmups = squatWk1.mainSets.filter((s) => s.kind === 'warmup');
    expect(warmups.map((s) => s.weight)).toEqual([105, 135, 160]);
  });

  it('(b) completeCycle: finalTms squat 265 → next cycle week-1 squat top set 225', async () => {
    await initializeFromOnboarding(lbOnboardingPayload({ roundingIncrement: 5 }));
    const c2 = await completeCycle(CANARY_TMS);

    const squatWk1 = (await getCycleWorkouts(c2.id)).find(
      (w) => w.liftId === 'squat' && w.week === 1,
    )!;
    expect(squatWk1.tmUsed).toBe(265);
    const top = squatWk1.mainSets.filter((s) => s.kind === 'work')[2]!;
    expect(top.weight).toBe(225); // NOT 230

    // Deadlift (TM bump 10) also rounds to 5: 350 × 0.85 = 297.5 → 300 (tie up).
    const dlWk1 = (await getCycleWorkouts(c2.id)).find(
      (w) => w.liftId === 'deadlift' && w.week === 1,
    )!;
    expect(
      dlWk1.mainSets.filter((s) => s.kind === 'work').every((s) => isMultipleOf(s.weight, 5)),
    ).toBe(true);
  });

  it('(c) TM override: deadlift → 287 @ rounding 2.5 → regenerated weights are multiples of 2.5, not 10', async () => {
    await initializeFromOnboarding(lbOnboardingPayload({ roundingIncrement: 2.5 }));
    await applyTmOverride('deadlift', 287);

    const cycle = await getActiveCycle();
    const dlWorkouts = (await getCycleWorkouts(cycle!.id)).filter((w) => w.liftId === 'deadlift');
    expect(dlWorkouts.length).toBeGreaterThan(0);
    for (const w of dlWorkouts) {
      expect(w.tmUsed).toBe(287);
      for (const s of w.mainSets) {
        expect(isMultipleOf(s.weight, 2.5)).toBe(true);
      }
    }
    // Concrete vector: week 1 work = 287 × 0.65/0.75/0.85 = 186.55/215.25/243.95
    // → 187.5/215/245 @ rounding 2.5 (all NON-multiples of 10 for the 1st/3rd).
    const wk1 = dlWorkouts.find((w) => w.week === 1)!;
    expect(wk1.mainSets.filter((s) => s.kind === 'work').map((s) => s.weight)).toEqual([
      187.5, 215, 245,
    ]);
  });

  it('deload add: week-4 weights also round to roundingIncrement', async () => {
    await initializeFromOnboarding(
      lbOnboardingPayload({
        roundingIncrement: 5,
        trainingMaxes: CANARY_TMS,
        includeDeload: false,
      }),
    );
    await addDeloadToActiveCycle();
    const cycle = await getActiveCycle();
    const squatWk4 = (await getCycleWorkouts(cycle!.id)).find(
      (w) => w.liftId === 'squat' && w.week === 4,
    )!;
    // 265 × 0.4/0.5/0.6 = 106/132.5/159 → 105/135/160 @ rounding 5.
    expect(squatWk4.mainSets.map((s) => s.weight)).toEqual([105, 135, 160]);
  });
});
