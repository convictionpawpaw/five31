// Shared fixtures for the StrongLifts db suites. Not a test file itself (the
// vitest include glob only picks up *.test.ts), so it may be imported freely.
import { lbOnboardingPayload } from './setup.ts';
import { initializeFromOnboarding, type OnboardingPayload } from '../repo/onboardingRepo.ts';
import { completeCycleToSl, getCycleWorkouts } from '../repo/cycleRepo.ts';
import {
  finishSlSession,
  logSlSet,
  startSlSession,
  type SlLiftOutcome,
} from '../repo/slRepo.ts';
import { defaultSlIncrements } from '../../core/sl.ts';
import type { Cycle, SlLiftId, Workout } from '../../core/types.ts';

/**
 * Opening working weights for the test block. Chosen so every progression
 * vector is exact on the lb/5 grid, including the deload cases:
 *   squat 255 → 90% = 229.5 → 230   bench 170 → 153 → 155 (tie-free)
 *   row 135 → 121.5 → 120           press 100 → 90 → 90
 *   deadlift 300 → 270 → 270 (increments by 10)
 */
export const SL_WEIGHTS: Record<SlLiftId, number> = {
  squat: 255,
  bench: 170,
  row: 135,
  press: 100,
  deadlift: 300,
};

export interface SeedSlOptions {
  keepPrs?: boolean;
  weights?: Record<SlLiftId, number>;
  payload?: Partial<OnboardingPayload>;
}

/** Onboard a classic lb setup, then switch cycle 1 into a StrongLifts block. */
export async function seedSlBlock(options: SeedSlOptions = {}): Promise<Cycle> {
  await initializeFromOnboarding(lbOnboardingPayload(options.payload));
  return completeCycleToSl({
    weights: options.weights ?? SL_WEIGHTS,
    increments: defaultSlIncrements('lb'),
    keepPrs: options.keepPrs ?? true,
  });
}

/** Every row of one session, in no particular order. */
export async function sessionRows(cycleId: string, session: number): Promise<Workout[]> {
  return (await getCycleWorkouts(cycleId)).filter((w) => w.session === session);
}

/** One session's row for a given lift. */
export async function sessionRow(
  cycleId: string,
  session: number,
  liftId: SlLiftId,
): Promise<Workout> {
  const row = (await sessionRows(cycleId, session)).find((w) => w.liftId === liftId);
  if (!row) throw new Error(`test fixture: session ${session} has no ${liftId} row`);
  return row;
}

/**
 * Start a session, log `reps` on every work set of every lift (5 unless the lift
 * is named in `repsByLift`), then finish it. Returns the per-lift outcomes.
 */
export async function playSession(
  cycleId: string,
  session: number,
  repsByLift: Partial<Record<SlLiftId, number>> = {},
): Promise<SlLiftOutcome[]> {
  const rows = await startSlSession(cycleId, session);
  for (const w of rows) {
    const reps = repsByLift[w.liftId] ?? 5;
    for (const set of w.mainSets) {
      await logSlSet(w.id, set.index, reps);
    }
  }
  return finishSlSession(cycleId, session);
}

/** The keys no classic 5/3/1 row may ever grow — the friend-path pins. */
export const NEW_KEYS = [
  'program',
  'sl',
  'session',
  'slSlot',
  'prResets',
  'pendingProgramSwitch',
] as const;
