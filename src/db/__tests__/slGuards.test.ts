import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, lbOnboardingPayload } from './setup.ts';
import { SL_WEIGHTS, seedSlBlock, sessionRow, sessionRows } from './slHelpers.ts';
import { initializeFromOnboarding } from '../repo/onboardingRepo.ts';
import {
  addDeloadToActiveCycle,
  completeCycle,
  getActiveCycle,
  getCycleWorkouts,
  removeDeloadFromActiveCycle,
} from '../repo/cycleRepo.ts';
import {
  editPastWorkout,
  logMainSet,
  skipWorkout,
  startWorkout,
  unskipWorkout,
} from '../repo/workoutRepo.ts';
import { finishSlSession, logSlSet, startSlSession } from '../repo/slRepo.ts';
import { applyTmOverride } from '../repo/tmOverrideRepo.ts';
import { switchUnits } from '../repo/unitsRepo.ts';
import { db } from '../db.ts';
import { convertWeight } from '../../core/units.ts';
import { roundToIncrement } from '../../core/rounding.ts';
import type { LiftId } from '../../core/types.ts';

beforeEach(resetDb);

const FINAL_TMS: Record<LiftId, number> = {
  press: 125,
  bench: 205,
  squat: 310,
  deadlift: 360,
};

describe('classic cycle mutations refuse a StrongLifts block', () => {
  it('completeCycle throws (use the SL completion functions)', async () => {
    const block = await seedSlBlock();
    await expect(completeCycle(FINAL_TMS)).rejects.toThrow(/StrongLifts block/);
    // Nothing advanced: the block is still the sole active cycle.
    const active = await getActiveCycle();
    expect(active!.id).toBe(block.id);
    expect(await db.cycles.count()).toBe(2); // the closed 5/3/1 cycle + the block
    expect((await db.tmEvents.toArray()).filter((e) => e.type === 'cycle_advance')).toHaveLength(0);
  });

  it('WEEK-4 FOOTGUN: addDeloadToActiveCycle throws instead of stacking week-4 rows', async () => {
    const block = await seedSlBlock();
    // Sessions 10–12 carry week === 4 — the reason this guard exists.
    const week4 = (await getCycleWorkouts(block.id)).filter((w) => w.week === 4);
    expect(week4).toHaveLength(9);
    expect(new Set(week4.map((w) => w.session))).toEqual(new Set([10, 11, 12]));

    await expect(addDeloadToActiveCycle()).rejects.toThrow(/StrongLifts block/);
    expect(await getCycleWorkouts(block.id)).toHaveLength(36);
    expect((await getActiveCycle())!.includeDeload).toBe(false);
  });

  it('WEEK-4 FOOTGUN: removeDeloadFromActiveCycle throws instead of DELETING sessions 10–12', async () => {
    const block = await seedSlBlock();
    await expect(removeDeloadFromActiveCycle()).rejects.toThrow(/StrongLifts block/);
    const rows = await getCycleWorkouts(block.id);
    expect(rows).toHaveLength(36);
    expect(rows.filter((w) => w.week === 4)).toHaveLength(9); // all nine survived
  });

  it('applyTmOverride throws (TMs are dormant during a block)', async () => {
    const block = await seedSlBlock();
    await expect(applyTmOverride('squat', 999)).rejects.toThrow(/StrongLifts block/);

    const active = await getActiveCycle();
    expect(active!.tms.squat).toBe(300); // the parked snapshot is untouched
    expect((await db.liftState.get('squat'))!.trainingMax).toBe(300);
    expect((await db.tmEvents.toArray()).filter((e) => e.type === 'manual_override')).toHaveLength(
      0,
    );
    expect((await getCycleWorkouts(block.id)).every((w) => w.mainSets.length === 0)).toBe(true);
  });

  it('the same mutations still work on a classic cycle (the guards are program-scoped)', async () => {
    await initializeFromOnboarding(lbOnboardingPayload({ includeDeload: false }));
    await addDeloadToActiveCycle();
    expect(await getCycleWorkouts((await getActiveCycle())!.id)).toHaveLength(16);
    await removeDeloadFromActiveCycle();
    expect(await getCycleWorkouts((await getActiveCycle())!.id)).toHaveLength(12);
    await applyTmOverride('squat', 305);
    expect((await getActiveCycle())!.tms.squat).toBe(305);
    const next = await completeCycle(FINAL_TMS);
    expect(next.number).toBe(2);
  });
});

describe('per-row workout mutations refuse StrongLifts rows', () => {
  it('logMainSet on a PENDING StrongLifts row throws "Start the session first."', async () => {
    const block = await seedSlBlock();
    const squat = await sessionRow(block.id, 1, 'squat');
    await expect(logMainSet(squat.id, 'work', 0, 5)).rejects.toThrow('Start the session first.');
    await expect(logSlSet(squat.id, 0, 5)).rejects.toThrow('Start the session first.');
    // Still pending, still unstamped — the auto-start path never ran.
    const after = await sessionRow(block.id, 1, 'squat');
    expect(after.status).toBe('pending');
    expect(after.mainSets).toHaveLength(0);
    expect(after.accessoryWork).toHaveLength(0);
  });

  it('logMainSet on an IN-PROGRESS StrongLifts row logs normally', async () => {
    const block = await seedSlBlock();
    const rows = await startSlSession(block.id, 1);
    const squat = rows.find((w) => w.liftId === 'squat')!;
    await logMainSet(squat.id, 'work', 0, 5);
    await logSlSet(squat.id, 1, 4);
    const after = await sessionRow(block.id, 1, 'squat');
    expect(after.mainSets[0]!.actualReps).toBe(5);
    expect(after.mainSets[1]!.actualReps).toBe(4);
    expect(after.mainSets[0]!.loggedAt).toBeDefined();
  });

  it('startWorkout throws on a StrongLifts row (sessions start as a unit)', async () => {
    const block = await seedSlBlock();
    const squat = await sessionRow(block.id, 1, 'squat');
    await expect(startWorkout(squat.id)).rejects.toThrow(/startSlSession/);
    expect((await sessionRow(block.id, 1, 'squat')).status).toBe('pending');
  });

  it('skipWorkout / unskipWorkout throw on StrongLifts rows and point at the session functions', async () => {
    const block = await seedSlBlock();
    const squat = await sessionRow(block.id, 1, 'squat');
    await expect(skipWorkout(squat.id)).rejects.toThrow(/skipSlSession/);
    await expect(unskipWorkout(squat.id)).rejects.toThrow(/unskipSlSession/);
    expect((await sessionRows(block.id, 1)).every((w) => w.status === 'pending')).toBe(true);
  });

  it('editPastWorkout needs NO guard: it edits reps + notes on a completed SL row', async () => {
    const block = await seedSlBlock();
    const rows = await startSlSession(block.id, 1);
    const squat = rows.find((w) => w.liftId === 'squat')!;
    for (const set of squat.mainSets) await logSlSet(squat.id, set.index, 5);
    await finishSlSession(block.id, 1);
    const weightBefore = (await getActiveCycle())!.sl!.lifts.squat.weight;

    await editPastWorkout(squat.id, { mainSetReps: [{ kind: 'work', index: 4, actualReps: 3 }], notes: 'sloppy' });

    const after = await sessionRow(block.id, 1, 'squat');
    expect(after.mainSets[4]!.actualReps).toBe(3);
    expect(after.notes).toBe('sloppy');
    expect(after.editedAt).toBeDefined();
    // Weights, tmUsed and status are untouched, and progression never re-runs.
    expect(after.status).toBe('completed');
    expect(after.tmUsed).toBe(255);
    expect(after.mainSets.map((s) => s.weight)).toEqual([255, 255, 255, 255, 255]);
    expect((await getActiveCycle())!.sl!.lifts.squat.weight).toBe(weightBefore);
  });
});

describe('switchUnits during a StrongLifts block', () => {
  it('converts the block runtime (weight AND increment) and the parked TM snapshot', async () => {
    await seedSlBlock();
    await switchUnits('kg');

    const active = await getActiveCycle();
    expect(active!.units).toBe('kg');

    // Parked TMs still convert, ready for the switch back.
    expect(active!.tms.squat).toBe(roundToIncrement(convertWeight(300, 'lb', 'kg'), 2.5));

    const squat = active!.sl!.lifts.squat;
    expect(squat.weight).toBe(roundToIncrement(convertWeight(SL_WEIGHTS.squat, 'lb', 'kg'), 2.5));
    expect(squat.increment).toBe(roundToIncrement(convertWeight(5, 'lb', 'kg'), 2.5));
    expect(squat.increment).toBeGreaterThan(0);
    const deadlift = active!.sl!.lifts.deadlift;
    expect(deadlift.increment).toBe(roundToIncrement(convertWeight(10, 'lb', 'kg'), 2.5));
    expect(active!.sl!.lifts.row.weight).toBe(
      roundToIncrement(convertWeight(SL_WEIGHTS.row, 'lb', 'kg'), 2.5),
    );
    expect(active!.sl!.keepPrs).toBe(true);
  });

  it('carries fail streaks through a unit switch and never re-rounds them away', async () => {
    const block = await seedSlBlock();
    const rows = await startSlSession(block.id, 1);
    for (const w of rows) {
      for (const set of w.mainSets) await logSlSet(w.id, set.index, 1); // everything misses
    }
    await finishSlSession(block.id, 1);
    expect((await getActiveCycle())!.sl!.lifts.squat.failStreak).toBe(1);

    await switchUnits('kg');
    expect((await getActiveCycle())!.sl!.lifts.squat.failStreak).toBe(1);
  });

  it('does NOT touch StrongLifts workout rows — stamped rows stay frozen, pending stay empty', async () => {
    const block = await seedSlBlock();
    await startSlSession(block.id, 1);
    const stampedBefore = await sessionRows(block.id, 1);

    await switchUnits('kg');

    const stampedAfter = await sessionRows(block.id, 1);
    expect(stampedAfter).toEqual(stampedBefore); // same units, same frozen weights
    expect(stampedAfter.every((w) => w.units === 'lb')).toBe(true);
    expect((await sessionRow(block.id, 1, 'squat')).mainSets.map((s) => s.weight)).toEqual([
      255, 255, 255, 255, 255,
    ]);

    // Pending rows were never regenerated from a TM percentage scheme.
    const pending = (await getCycleWorkouts(block.id)).filter((w) => w.status === 'pending');
    expect(pending).toHaveLength(33);
    expect(pending.every((w) => w.mainSets.length === 0 && w.tmUsed === 0)).toBe(true);
  });

  it('re-stamps the NEXT session from the converted runtime', async () => {
    const block = await seedSlBlock();
    await switchUnits('kg');
    const rows = await startSlSession(block.id, 1);
    const expected = roundToIncrement(convertWeight(SL_WEIGHTS.squat, 'lb', 'kg'), 2.5);
    expect(rows.find((w) => w.liftId === 'squat')!.mainSets.map((s) => s.weight)).toEqual([
      expected,
      expected,
      expected,
      expected,
      expected,
    ]);
  });

  it('leaves a classic cycle converting exactly as before', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    await switchUnits('kg');
    const active = await getActiveCycle();
    const squatWk1 = (await getCycleWorkouts(active!.id)).find(
      (w) => w.liftId === 'squat' && w.week === 1,
    )!;
    expect(squatWk1.units).toBe('kg');
    expect(squatWk1.tmUsed).toBe(roundToIncrement(convertWeight(300, 'lb', 'kg'), 2.5));
    expect(squatWk1.mainSets.length).toBeGreaterThan(0);
  });
});
