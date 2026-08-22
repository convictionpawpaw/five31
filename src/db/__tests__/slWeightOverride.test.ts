import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './setup.ts';
import { SL_WEIGHTS, playSession, seedSlBlock, sessionRow } from './slHelpers.ts';
import { getActiveCycle, getCycleWorkouts } from '../repo/cycleRepo.ts';
import { overrideSlLiftWeight, startSlSession } from '../repo/slRepo.ts';

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

  it('never rewrites a stamped row — the session in flight keeps its weight', async () => {
    const block = await seedSlBlock();
    await startSlSession(block.id, 1);

    await overrideSlLiftWeight(block.id, 'squat', 185);

    const stamped = await sessionRow(block.id, 1, 'squat');
    expect(stamped.tmUsed).toBe(SL_WEIGHTS.squat);
    expect(stamped.mainSets.every((s) => s.weight === SL_WEIGHTS.squat)).toBe(true);
    // Every later row is still unstamped and will pick the new weight up.
    const later = (await getCycleWorkouts(block.id)).filter((w) => (w.session ?? 0) > 1);
    expect(later.every((w) => w.mainSets.length === 0 && w.tmUsed === 0)).toBe(true);
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
