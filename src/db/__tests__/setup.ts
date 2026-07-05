// Registers a fake IndexedDB implementation on the global scope so Dexie works
// under Vitest's `node` environment. Importing this module for its side effects
// MUST happen before the db module (and thus `new Dexie()`) is first evaluated,
// so every db test imports this file first.
import 'fake-indexeddb/auto';

import { db } from '../db.ts';
import type { OnboardingPayload } from '../repo/onboardingRepo.ts';
import type { LiftId } from '../../core/types.ts';

/** Wipe every table so each test starts from an empty database. */
export async function resetDb(): Promise<void> {
  await Promise.all([
    db.settings.clear(),
    db.liftState.clear(),
    db.cycles.clear(),
    db.workouts.clear(),
    db.accessories.clear(),
    db.bodyweight.clear(),
    db.tmEvents.clear(),
  ]);
}

/** A canonical lb onboarding payload used across tests (TMs chosen for clean vectors). */
export function lbOnboardingPayload(
  overrides: Partial<OnboardingPayload> = {},
): OnboardingPayload {
  const trainingMaxes: Record<LiftId, number> = {
    press: 120,
    bench: 200,
    squat: 300,
    deadlift: 350,
  };
  const liftIncrements: Record<LiftId, number> = {
    press: 5,
    bench: 5,
    squat: 10,
    deadlift: 10,
  };
  return {
    units: 'lb',
    roundingIncrement: 5,
    tmPercent: 0.9,
    includeDeload: false,
    liftIncrements,
    trainingMaxes,
    ...overrides,
  };
}
