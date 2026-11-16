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
    db.stretchSessions.clear(),
    db.savedRoutines.clear(),
  ]);
}

/**
 * Mark one pending workout of the active cycle skipped, directly in the table.
 * completeCycle / completeSlCycleContinue refuse a cycle with NO resolved
 * workout (the empty-phantom guard), so suites that complete a freshly
 * onboarded cycle resolve one row first. Returns the skipped workout's id.
 */
export async function resolveOneWorkout(): Promise<string> {
  const active = await db.cycles.where('status').equals('active').first();
  if (!active) throw new Error('test fixture: no active cycle');
  const row = (await db.workouts.where('cycleId').equals(active.id).toArray()).find(
    (w) => w.status === 'pending',
  );
  if (!row) throw new Error('test fixture: no pending workout to resolve');
  await db.workouts.put({ ...row, status: 'skipped' });
  return row.id;
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
