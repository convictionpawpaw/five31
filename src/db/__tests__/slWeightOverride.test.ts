import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './setup.ts';
import { SL_WEIGHTS, playSession, seedSlBlock, sessionRow } from './slHelpers.ts';
import { getActiveCycle, getCycleWorkouts } from '../repo/cycleRepo.ts';
import {
  SL_OVERRIDE_IN_FLIGHT_ERROR,
  finishSlSession,
  logSlSet,
  overrideSlLiftWeight,
  skipSlSession,
  slOverrideBlockedByInFlight,
  startSlSession,
} from '../repo/slRepo.ts';

beforeEach(resetDb);

describe('overrideSlLiftWeight', () => {
  it('moves only the named lift, leaving the other four runtimes untouched', async () => {
    const block = await seedSlBlock();
    await overrideSlLiftWeight(block.id, 'row', 95);

    const after = await getActiveCycle();
    expect(after!.sl!.lifts.row.weight).toBe(95);
    expect(after!.sl!.lifts.squat.weight).toBe(SL_WEIGHTS.squat);
    expect(after!.sl!.lifts.bench.weight).toBe(SL_WEIGHTS.bench);
    expect(after!.sl!.lifts.press.weight).toBe(SL_WEIGHTS.press);
    expect(after!.sl!.lifts.deadlift.weight).toBe(SL_WEIGHTS.deadlift);
  });

  it('PRESERVES the increment and the fail streak — a deload stays earned', async () => {
    const block = await seedSlBlock();
    // Two straight misses on the bench put it one miss from a deload.
    await playSession(block.id, 1, { bench: 2 });
    await playSession(block.id, 2);
    await playSession(block.id, 3, { bench: 2 });

    const before = (await getActiveCycle())!.sl!.lifts.bench;
    expect(before.failStreak).toBe(2);

    await overrideSlLiftWeight(block.id, 'bench', 160);
    const after = (await getActiveCycle())!.sl!.lifts.bench;
    expect(after.weight).toBe(160);
    expect(after.failStreak).toBe(2);
    expect(after.increment).toBe(before.increment);
  });

  it('REFUSES a lift the session in flight is training', async () => {
    // The modal promises "applies from the next session onward". It could not
    // keep that promise: finishSlSession progresses from the LIVE runtime, not
    // from the weight stamped on the row, so an override applied mid-session is
    // compounded — a pass writes override + increment, and a third miss deloads
    // to 90% of a weight that was never lifted. Refusing the write is the fix.
    const block = await seedSlBlock();
    await startSlSession(block.id, 1); // session 1 = A: squat / bench / row

    await expect(overrideSlLiftWeight(block.id, 'squat', 185)).rejects.toThrow(
      SL_OVERRIDE_IN_FLIGHT_ERROR,
    );

    // Nothing moved: not the runtime, not the stamped row.
    expect((await getActiveCycle())!.sl!.lifts.squat.weight).toBe(SL_WEIGHTS.squat);
    const stamped = await sessionRow(block.id, 1, 'squat');
    expect(stamped.tmUsed).toBe(SL_WEIGHTS.squat);
    expect(stamped.mainSets.every((s) => s.weight === SL_WEIGHTS.squat)).toBe(true);
  });

  it('still allows a lift the in-flight session does NOT train', async () => {
    // Session 1 is slot A (squat/bench/row); the press and deadlift are slot B,
    // so nothing in flight can consume an override of them.
    const block = await seedSlBlock();
    await startSlSession(block.id, 1);

    await overrideSlLiftWeight(block.id, 'press', 85);
    expect((await getActiveCycle())!.sl!.lifts.press.weight).toBe(85);

    // The stamped session is untouched, and every later row is still unstamped
    // and will pick the new press weight up on its own start.
    const stamped = await sessionRow(block.id, 1, 'squat');
    expect(stamped.tmUsed).toBe(SL_WEIGHTS.squat);
    const later = (await getCycleWorkouts(block.id)).filter((w) => (w.session ?? 0) > 1);
    expect(later.every((w) => w.mainSets.length === 0 && w.tmUsed === 0)).toBe(true);
  });

  it('the refusal lifts as soon as the session is finished or skipped', async () => {
    const block = await seedSlBlock();
    const rows = await startSlSession(block.id, 1);
    await expect(overrideSlLiftWeight(block.id, 'bench', 150)).rejects.toThrow(
      SL_OVERRIDE_IN_FLIGHT_ERROR,
    );
    for (const w of rows) for (const set of w.mainSets) await logSlSet(w.id, set.index, 5);
    await finishSlSession(block.id, 1);

    // Session 2 is now the earliest unresolved one, and is NOT yet stamped.
    await overrideSlLiftWeight(block.id, 'bench', 150);
    expect((await getActiveCycle())!.sl!.lifts.bench.weight).toBe(150);
  });

  it('does not block on a session that is merely PENDING (nothing is in flight)', async () => {
    const block = await seedSlBlock();
    const workouts = await getCycleWorkouts(block.id);
    expect(slOverrideBlockedByInFlight(workouts, 'squat')).toBe(false);
    await overrideSlLiftWeight(block.id, 'squat', 185);
    expect((await getActiveCycle())!.sl!.lifts.squat.weight).toBe(185);

    // A skipped session is resolved, so it is not "in flight" either.
    await skipSlSession(block.id, 1);
    await overrideSlLiftWeight(block.id, 'squat', 190);
    expect((await getActiveCycle())!.sl!.lifts.squat.weight).toBe(190);
  });

  it('applies to the NEXT session that starts', async () => {
    const block = await seedSlBlock();
    await overrideSlLiftWeight(block.id, 'squat', 185);
    const rows = await startSlSession(block.id, 1);
    expect(rows.find((w) => w.liftId === 'squat')!.tmUsed).toBe(185);
  });

  it('rejects a non-positive weight and a cycle that is not the active block', async () => {
    const block = await seedSlBlock();
    await expect(overrideSlLiftWeight(block.id, 'squat', 0)).rejects.toThrow(/greater than zero/);
    await expect(overrideSlLiftWeight('not-a-cycle', 'squat', 200)).rejects.toThrow(
      /not the active cycle/,
    );
    // The failed writes left nothing behind.
    expect((await getActiveCycle())!.sl!.lifts.squat.weight).toBe(SL_WEIGHTS.squat);
  });
});
