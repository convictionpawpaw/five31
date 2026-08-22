import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDb, lbOnboardingPayload } from './setup.ts';
import { SL_WEIGHTS, playSession, seedSlBlock, sessionRow, sessionRows } from './slHelpers.ts';
import { initializeFromOnboarding } from '../repo/onboardingRepo.ts';
import {
  SL_RETURN_TM_NOTE,
  completeCycleToSl,
  completeSlCycleContinue,
  completeSlCycleReturn,
  getActiveCycle,
  getCycleWorkouts,
  listCycles,
} from '../repo/cycleRepo.ts';
import {
  earliestUnresolvedSlSession,
  finishSlSession,
  logSlSet,
  skipSlSession,
  startSlSession,
  unskipSlSession,
} from '../repo/slRepo.ts';
import { getSettings, setPendingProgramSwitch } from '../repo/settingsRepo.ts';
import { getAllLiftStates } from '../repo/liftStateRepo.ts';
import { listAllTmEvents } from '../repo/tmEventRepo.ts';
import { db } from '../db.ts';
import { defaultSlIncrements } from '../../core/sl.ts';
import { makeWorkoutOrderComparator } from '../../features/shared/workoutSelect.ts';
import type { LiftId } from '../../core/types.ts';

beforeEach(resetDb);

const RETURN_TMS: Record<LiftId, number> = {
  press: 120,
  bench: 215,
  squat: 300,
  deadlift: 350,
};

describe('completeCycleToSl (5/3/1 → StrongLifts)', () => {
  it('closes the 5/3/1 cycle and opens a 36-row block with lazy weights', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const classic = await getActiveCycle();

    const block = await completeCycleToSl({
      weights: SL_WEIGHTS,
      increments: defaultSlIncrements('lb'),
      keepPrs: true,
    });

    const classicAfter = await db.cycles.get(classic!.id);
    expect(classicAfter!.status).toBe('completed');
    expect(classicAfter!.completedAt).toBeDefined();

    expect(block.number).toBe(2);
    expect(block.status).toBe('active');
    expect(block.program).toBe('sl5x5');
    expect(block.includeDeload).toBe(false); // a block is 12 sessions, never 16
    // TMs ride along dormant, carried verbatim from the closed cycle.
    expect(block.tms).toEqual(classic!.tms);
    expect(block.sl!.keepPrs).toBe(true);
    expect(block.sl!.lifts.squat).toEqual({ weight: 255, increment: 5, failStreak: 0 });
    expect(block.sl!.lifts.deadlift).toEqual({ weight: 300, increment: 10, failStreak: 0 });
    expect(block.sl!.lifts.row).toEqual({ weight: 135, increment: 5, failStreak: 0 });

    const rows = await getCycleWorkouts(block.id);
    expect(rows).toHaveLength(36);
    expect(rows.every((w) => w.status === 'pending')).toBe(true);
    expect(rows.every((w) => w.program === 'sl5x5')).toBe(true);
    expect(rows.every((w) => w.mainSets.length === 0)).toBe(true); // LAZY
    expect(rows.every((w) => w.tmUsed === 0)).toBe(true);
    expect(rows.every((w) => w.accessoryWork.length === 0)).toBe(true);
    // 12 sessions × 3 rows, squat in every one.
    expect(new Set(rows.map((w) => w.session)).size).toBe(12);
    expect(rows.filter((w) => w.liftId === 'squat')).toHaveLength(12);
    expect(rows.filter((w) => w.liftId === 'row')).toHaveLength(6);
    expect(rows.filter((w) => w.liftId === 'deadlift')).toHaveLength(6);

    expect((await listCycles()).filter((c) => c.status === 'active')).toHaveLength(1);
  });

  it('writes ZERO TmEvents and leaves LiftState untouched (TMs go dormant)', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const beforeEvents = await listAllTmEvents();
    const beforeStates = await getAllLiftStates();
    expect(beforeEvents).toHaveLength(4); // the 'initial' events onboarding wrote

    await completeCycleToSl({
      weights: SL_WEIGHTS,
      increments: defaultSlIncrements('lb'),
      keepPrs: true,
    });

    const afterEvents = await listAllTmEvents();
    expect(afterEvents).toHaveLength(beforeEvents.length); // only the 4 'initial' ones
    expect(afterEvents.filter((e) => e.type === 'cycle_advance')).toHaveLength(0);
    expect(await getAllLiftStates()).toEqual(beforeStates);
  });

  it('keeps PRs by default: no prResets key is written', async () => {
    await seedSlBlock({ keepPrs: true });
    const settings = await getSettings();
    expect(Object.keys(settings!)).not.toContain('prResets');
  });

  it('keepPrs: false appends one ISO reset marker to Settings.prResets', async () => {
    await seedSlBlock({ keepPrs: false });
    const settings = await getSettings();
    expect(settings!.prResets).toHaveLength(1);
    expect(Date.parse(settings!.prResets![0]!)).not.toBeNaN();
    const active = await getActiveCycle();
    expect(active!.sl!.keepPrs).toBe(false);
  });

  it('consumes an armed pendingProgramSwitch (the key is deleted, not undefined)', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    await setPendingProgramSwitch('sl5x5');
    expect((await getSettings())!.pendingProgramSwitch).toBe('sl5x5');

    await completeCycleToSl({
      weights: SL_WEIGHTS,
      increments: defaultSlIncrements('lb'),
      keepPrs: true,
    });

    expect(Object.keys((await getSettings())!)).not.toContain('pendingProgramSwitch');
  });

  it('is all-or-nothing: a mid-transaction failure leaves the 5/3/1 cycle active', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const classic = await getActiveCycle();

    const spy = vi.spyOn(db.workouts, 'bulkAdd').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(
      completeCycleToSl({
        weights: SL_WEIGHTS,
        increments: defaultSlIncrements('lb'),
        keepPrs: false,
      }),
    ).rejects.toThrow('boom');
    spy.mockRestore();

    const active = await getActiveCycle();
    expect(active!.id).toBe(classic!.id);
    expect(active!.program).toBeUndefined();
    expect(await db.cycles.count()).toBe(1);
    expect(Object.keys((await getSettings())!)).not.toContain('prResets');
  });
});

describe('startSlSession (lazy stamping + sequential gate)', () => {
  it('stamps all three rows atomically at the block weights', async () => {
    const block = await seedSlBlock();
    const stamped = await startSlSession(block.id, 1);

    expect(stamped.map((w) => w.liftId)).toEqual(['squat', 'bench', 'row']); // performance order
    const rows = await sessionRows(block.id, 1);
    expect(rows.every((w) => w.status === 'in_progress')).toBe(true);
    expect(rows.every((w) => w.startedAt !== undefined)).toBe(true);

    const squat = await sessionRow(block.id, 1, 'squat');
    expect(squat.tmUsed).toBe(255); // an SL row's tmUsed IS its working weight
    expect(squat.mainSets).toHaveLength(5);
    expect(squat.mainSets.map((s) => s.weight)).toEqual([255, 255, 255, 255, 255]);
    expect(squat.mainSets.every((s) => s.kind === 'work' && s.targetReps === 5 && !s.amrap)).toBe(
      true,
    );
    expect((await sessionRow(block.id, 1, 'row')).mainSets.map((s) => s.weight)).toEqual([
      135, 135, 135, 135, 135,
    ]);

    // Untouched sessions stay lazy.
    expect((await sessionRows(block.id, 2)).every((w) => w.mainSets.length === 0)).toBe(true);
  });

  it('gives the deadlift a single work set (1×5)', async () => {
    const block = await seedSlBlock();
    await skipSlSession(block.id, 1);
    await startSlSession(block.id, 2);
    const dl = await sessionRow(block.id, 2, 'deadlift');
    expect(dl.mainSets).toHaveLength(1);
    expect(dl.mainSets[0]!.weight).toBe(300);
    expect((await sessionRow(block.id, 2, 'press')).mainSets).toHaveLength(5);
  });

  it('SEQUENTIAL GATE: a later session cannot be started before the current one', async () => {
    const block = await seedSlBlock();
    await expect(startSlSession(block.id, 2)).rejects.toThrow(/not next/);
    await expect(startSlSession(block.id, 7)).rejects.toThrow(/session 1 first/);
    // Nothing was stamped by the rejected calls.
    expect((await getCycleWorkouts(block.id)).every((w) => w.status === 'pending')).toBe(true);
  });

  it('resumes an in-progress session as a NO-OP (weights are frozen once stamped)', async () => {
    const block = await seedSlBlock();
    const first = await startSlSession(block.id, 1);
    const again = await startSlSession(block.id, 1);
    expect(again.map((w) => w.startedAt)).toEqual(first.map((w) => w.startedAt));
    expect(again.map((w) => w.tmUsed)).toEqual(first.map((w) => w.tmUsed));
  });

  it('never stamps accessory work on a StrongLifts row', async () => {
    const block = await seedSlBlock({
      payload: {
        accessories: [
          {
            liftDayId: 'bench',
            name: 'Dips',
            sets: 3,
            repRangeMin: 8,
            repRangeMax: 12,
            currentWeight: 40,
            increment: 5,
          },
          {
            liftDayId: 'squat',
            name: 'Leg Curl',
            sets: 3,
            repRangeMin: 8,
            repRangeMax: 12,
            currentWeight: 60,
            increment: 5,
          },
        ],
      },
    });
    expect(await db.accessories.count()).toBe(2); // the defs survive the switch

    await startSlSession(block.id, 1);
    const rows = await sessionRows(block.id, 1);
    expect(rows.every((w) => w.accessoryWork.length === 0)).toBe(true);
  });

  it('rejects an out-of-range session number', async () => {
    const block = await seedSlBlock();
    await expect(startSlSession(block.id, 13)).rejects.toThrow(/out of range/);
    await expect(startSlSession(block.id, 0)).rejects.toThrow(/out of range/);
  });

  it('rejects a cycle id that is not the active StrongLifts block', async () => {
    await seedSlBlock();
    await expect(startSlSession('not-a-cycle', 1)).rejects.toThrow(/not the active cycle/);
  });

  it('rejects a classic 5/3/1 cycle', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    const classic = await getActiveCycle();
    await expect(startSlSession(classic!.id, 1)).rejects.toThrow(/not a StrongLifts block/);
  });
});

describe('finishSlSession (progression)', () => {
  it('advances every passed lift by its increment and clears the streak', async () => {
    const block = await seedSlBlock();
    const outcomes = await playSession(block.id, 1);

    expect(outcomes.map((o) => o.liftId)).toEqual(['squat', 'bench', 'row']);
    expect(outcomes.every((o) => o.passed)).toBe(true);
    expect(outcomes.every((o) => !o.deloaded)).toBe(true);
    const squat = outcomes.find((o) => o.liftId === 'squat')!;
    expect(squat.before.weight).toBe(255);
    expect(squat.after).toEqual({ weight: 260, increment: 5, failStreak: 0 });

    const active = await getActiveCycle();
    expect(active!.sl!.lifts.squat.weight).toBe(260);
    expect(active!.sl!.lifts.bench.weight).toBe(175);
    expect(active!.sl!.lifts.row.weight).toBe(140);
    // Session-B lifts were not trained, so they are untouched.
    expect(active!.sl!.lifts.press.weight).toBe(100);
    expect(active!.sl!.lifts.deadlift.weight).toBe(300);

    const rows = await sessionRows(block.id, 1);
    expect(rows.every((w) => w.status === 'completed')).toBe(true);
    expect(rows.every((w) => w.completedAt !== undefined)).toBe(true);
  });

  it('adds the deadlift double increment on a session-B pass', async () => {
    const block = await seedSlBlock();
    await playSession(block.id, 1);
    await playSession(block.id, 2);
    const active = await getActiveCycle();
    expect(active!.sl!.lifts.deadlift.weight).toBe(310); // +10
    expect(active!.sl!.lifts.press.weight).toBe(105); // +5
    expect(active!.sl!.lifts.squat.weight).toBe(265); // squat trains every session
  });

  it('a miss repeats the weight and increments the fail streak', async () => {
    const block = await seedSlBlock();
    const outcomes = await playSession(block.id, 1, { squat: 4 });
    const squat = outcomes.find((o) => o.liftId === 'squat')!;
    expect(squat.passed).toBe(false);
    expect(squat.deloaded).toBe(false);
    expect(squat.after).toEqual({ weight: 255, increment: 5, failStreak: 1 });

    await playSession(block.id, 2, { squat: 4 });
    const active = await getActiveCycle();
    expect(active!.sl!.lifts.squat).toEqual({ weight: 255, increment: 5, failStreak: 2 });
  });

  it('the THIRD consecutive miss deloads to 90%, rounded, and clears the streak', async () => {
    const block = await seedSlBlock();
    await playSession(block.id, 1, { squat: 4 });
    await playSession(block.id, 2, { squat: 4 });
    const outcomes = await playSession(block.id, 3, { squat: 4 });

    const squat = outcomes.find((o) => o.liftId === 'squat')!;
    expect(squat.deloaded).toBe(true);
    expect(squat.before.failStreak).toBe(2);
    expect(squat.after).toEqual({ weight: 230, increment: 5, failStreak: 0 }); // 255×0.9 = 229.5 → 230

    const active = await getActiveCycle();
    expect(active!.sl!.lifts.squat.weight).toBe(230);
    // Bench missed sessions 1 and 3 only — two in a row, no deload yet.
    expect(active!.sl!.lifts.bench.failStreak).toBe(0); // it PASSED sessions 1 and 3
  });

  it('an unlogged set counts as a miss', async () => {
    const block = await seedSlBlock();
    const rows = await startSlSession(block.id, 1);
    const squat = rows.find((w) => w.liftId === 'squat')!;
    for (const set of squat.mainSets.slice(0, 4)) {
      await logSlSet(squat.id, set.index, 5); // 4 of 5 sets logged
    }
    const outcomes = await finishSlSession(block.id, 1);
    expect(outcomes.find((o) => o.liftId === 'squat')!.passed).toBe(false);
    expect((await getActiveCycle())!.sl!.lifts.squat.failStreak).toBe(1);
  });

  it('rejects a double finish (a weight can never advance twice)', async () => {
    const block = await seedSlBlock();
    await playSession(block.id, 1);
    await expect(finishSlSession(block.id, 1)).rejects.toThrow(/expected in_progress/);
    expect((await getActiveCycle())!.sl!.lifts.squat.weight).toBe(260); // advanced exactly once
  });

  it('rejects finishing a session that was never started', async () => {
    const block = await seedSlBlock();
    await expect(finishSlSession(block.id, 1)).rejects.toThrow(/Cannot finish session 1/);
  });

  it('is all-or-nothing: a row write failure leaves the block runtime unmoved', async () => {
    const block = await seedSlBlock();
    await startSlSession(block.id, 1);

    const spy = vi.spyOn(db.workouts, 'bulkPut').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(finishSlSession(block.id, 1)).rejects.toThrow('boom');
    spy.mockRestore();

    const active = await getActiveCycle();
    expect(active!.sl!.lifts.squat.weight).toBe(255); // NOT advanced
    expect((await sessionRows(block.id, 1)).every((w) => w.status === 'in_progress')).toBe(true);
  });
});

describe('skipSlSession / unskipSlSession', () => {
  it('skips all three rows and leaves the block runtime untouched', async () => {
    const block = await seedSlBlock();
    await skipSlSession(block.id, 1);

    const rows = await sessionRows(block.id, 1);
    expect(rows).toHaveLength(3);
    expect(rows.every((w) => w.status === 'skipped')).toBe(true);
    const active = await getActiveCycle();
    expect(active!.sl!.lifts.squat).toEqual({ weight: 255, increment: 5, failStreak: 0 });

    // The gate has advanced.
    expect(earliestUnresolvedSlSession(await getCycleWorkouts(block.id))).toBe(2);
    await expect(startSlSession(block.id, 2)).resolves.toHaveLength(3);
  });

  it('can skip a session that is already in progress, and re-skipping is a no-op', async () => {
    const block = await seedSlBlock();
    await startSlSession(block.id, 1);
    await skipSlSession(block.id, 1);
    await skipSlSession(block.id, 1);
    expect((await sessionRows(block.id, 1)).every((w) => w.status === 'skipped')).toBe(true);
    expect((await getActiveCycle())!.sl!.lifts.squat.weight).toBe(255);
  });

  it('refuses to skip a completed session', async () => {
    const block = await seedSlBlock();
    await playSession(block.id, 1);
    await expect(skipSlSession(block.id, 1)).rejects.toThrow(/already completed/);
  });

  it('unskip resets the rows to a FRESH pending shape (no reps, no stamp)', async () => {
    const block = await seedSlBlock();
    const started = await startSlSession(block.id, 1);
    await logSlSet(started[0]!.id, 0, 5);
    await skipSlSession(block.id, 1);

    await unskipSlSession(block.id, 1);

    const rows = await sessionRows(block.id, 1);
    expect(rows.every((w) => w.status === 'pending')).toBe(true);
    expect(rows.every((w) => w.mainSets.length === 0)).toBe(true);
    expect(rows.every((w) => w.tmUsed === 0)).toBe(true);
    for (const w of rows) {
      expect(Object.keys(w)).not.toContain('startedAt');
      expect(Object.keys(w)).not.toContain('completedAt');
    }
    // It re-stamps cleanly on the next start.
    const restamped = await startSlSession(block.id, 1);
    expect(restamped.find((w) => w.liftId === 'squat')!.mainSets).toHaveLength(5);
  });

  it('unskip is allowed while every later session is still pending', async () => {
    const block = await seedSlBlock();
    await playSession(block.id, 1);
    await skipSlSession(block.id, 2);
    await unskipSlSession(block.id, 2);
    expect((await sessionRows(block.id, 2)).every((w) => w.status === 'pending')).toBe(true);
  });

  it('unskip is REFUSED once a later session has been started', async () => {
    const block = await seedSlBlock();
    await skipSlSession(block.id, 1);
    await startSlSession(block.id, 2);
    await expect(unskipSlSession(block.id, 1)).rejects.toThrow(/a later session/);
    expect((await sessionRows(block.id, 1)).every((w) => w.status === 'skipped')).toBe(true);
  });

  it('refuses to unskip a session that is not skipped', async () => {
    const block = await seedSlBlock();
    await expect(unskipSlSession(block.id, 1)).rejects.toThrow(/Cannot unskip session 1/);
  });
});

describe('completeSlCycleContinue (5×5 → 5×5)', () => {
  it('carries the runtime VERBATIM — weights AND fail streaks', async () => {
    const block = await seedSlBlock();
    await playSession(block.id, 1, { squat: 4 }); // squat streak 1, bench/row +5
    await playSession(block.id, 2); // squat passes → streak clears, +5
    await playSession(block.id, 3, { bench: 4 }); // bench streak 1
    const before = (await getActiveCycle())!.sl!;

    const next = await completeSlCycleContinue();

    expect(next.number).toBe(3);
    expect(next.program).toBe('sl5x5');
    expect(next.sl).toEqual(before); // weights AND failStreaks, unchanged
    expect(next.sl!.lifts.bench.failStreak).toBe(1);
    expect(next.units).toBe(block.units);
    expect(await getCycleWorkouts(next.id)).toHaveLength(36);
    expect((await getCycleWorkouts(next.id)).every((w) => w.status === 'pending')).toBe(true);

    const closed = await db.cycles.get(block.id);
    expect(closed!.status).toBe('completed');
    expect((await listCycles()).filter((c) => c.status === 'active')).toHaveLength(1);
  });

  it('writes no TmEvents and does not touch LiftState', async () => {
    const block = await seedSlBlock();
    const beforeEvents = await listAllTmEvents();
    const beforeStates = await getAllLiftStates();
    await playSession(block.id, 1);
    await completeSlCycleContinue();
    expect(await listAllTmEvents()).toHaveLength(beforeEvents.length);
    expect(await getAllLiftStates()).toEqual(beforeStates);
  });

  it('throws when the active cycle is a classic 5/3/1 cycle', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    await expect(completeSlCycleContinue()).rejects.toThrow(/not a StrongLifts block/);
  });
});

describe('completeSlCycleReturn (5×5 → 5/3/1)', () => {
  it('wakes the TMs up: cycle_advance events, LiftState, and a classic cycle', async () => {
    const block = await seedSlBlock();
    await playSession(block.id, 1);

    const classic = await completeSlCycleReturn(RETURN_TMS);

    expect(classic.number).toBe(3);
    expect(classic.status).toBe('active');
    expect(classic.program).toBeUndefined();
    expect(Object.keys(classic)).not.toContain('sl');
    expect(classic.tms).toEqual(RETURN_TMS);

    const advance = (await listAllTmEvents()).filter((e) => e.type === 'cycle_advance');
    expect(advance).toHaveLength(4);
    expect(advance.every((e) => e.note === SL_RETURN_TM_NOTE)).toBe(true);
    const bench = advance.find((e) => e.liftId === 'bench')!;
    expect(bench.fromValue).toBe(200); // the dormant TM the block carried
    expect(bench.toValue).toBe(215);
    expect(bench.cycleId).toBe(block.id);

    const states = await getAllLiftStates();
    expect(states.find((s) => s.liftId === 'bench')!.trainingMax).toBe(215);

    const rows = await getCycleWorkouts(classic.id);
    expect(rows).toHaveLength(12); // includeDeload false in the payload
    expect(rows.every((w) => w.program === undefined)).toBe(true);
    expect(rows.every((w) => w.mainSets.length > 0)).toBe(true); // classic = eager weights
    // Bench week 1 @ TM 215 → 0.65/0.75/0.85 = 139.75/161.25/182.75 → 140/160/185.
    const benchWk1 = rows.find((w) => w.liftId === 'bench' && w.week === 1)!;
    expect(benchWk1.mainSets.filter((s) => s.kind === 'work').map((s) => s.weight)).toEqual([
      140, 160, 185,
    ]);

    expect((await db.cycles.get(block.id))!.status).toBe('completed');
  });

  it('honors Settings.includeDeload and Settings.dayOrder for the new cycle', async () => {
    const dayOrder: LiftId[] = ['squat', 'bench', 'deadlift', 'press'];
    const block = await seedSlBlock({ payload: { includeDeload: true, dayOrder } });
    await playSession(block.id, 1);

    const classic = await completeSlCycleReturn(RETURN_TMS);
    expect(classic.includeDeload).toBe(true);
    const rows = await getCycleWorkouts(classic.id);
    expect(rows).toHaveLength(16);
    const week1 = [...rows]
      .sort(makeWorkoutOrderComparator(dayOrder))
      .filter((w) => w.week === 1)
      .map((w) => w.liftId);
    expect(week1).toEqual(dayOrder);
  });

  it('keeps PRs by default and appends a reset marker when asked not to', async () => {
    const block = await seedSlBlock({ keepPrs: false }); // switch IN wrote marker #1
    await playSession(block.id, 1);
    await completeSlCycleReturn(RETURN_TMS, false);

    const settings = await getSettings();
    expect(settings!.prResets).toHaveLength(2); // append-only, never rewritten
    expect(settings!.prResets![0]! <= settings!.prResets![1]!).toBe(true);
  });

  it('consumes an armed pendingProgramSwitch', async () => {
    const block = await seedSlBlock();
    await setPendingProgramSwitch('five31');
    await playSession(block.id, 1);
    await completeSlCycleReturn(RETURN_TMS);
    expect(Object.keys((await getSettings())!)).not.toContain('pendingProgramSwitch');
  });

  it('leaves prResets absent when PRs are kept on both switches', async () => {
    const block = await seedSlBlock({ keepPrs: true });
    await playSession(block.id, 1);
    await completeSlCycleReturn(RETURN_TMS, true);
    expect(Object.keys((await getSettings())!)).not.toContain('prResets');
  });

  it('throws when the active cycle is a classic 5/3/1 cycle', async () => {
    await initializeFromOnboarding(lbOnboardingPayload());
    await expect(completeSlCycleReturn(RETURN_TMS)).rejects.toThrow(/not a StrongLifts block/);
  });
});

describe('earliestUnresolvedSlSession', () => {
  it('walks the block in order and returns null once every session is resolved', async () => {
    const block = await seedSlBlock();
    expect(earliestUnresolvedSlSession(await getCycleWorkouts(block.id))).toBe(1);
    await playSession(block.id, 1);
    expect(earliestUnresolvedSlSession(await getCycleWorkouts(block.id))).toBe(2);
    for (let session = 2; session <= 12; session++) {
      await skipSlSession(block.id, session);
    }
    expect(earliestUnresolvedSlSession(await getCycleWorkouts(block.id))).toBeNull();
    await expect(startSlSession(block.id, 12)).rejects.toThrow(/block is finished/);
  });
});
