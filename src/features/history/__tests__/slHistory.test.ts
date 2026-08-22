import { describe, it, expect } from 'vitest';
import type { Workout } from '../../../core/types.ts';
import { classicCycle, playInBlock, slBlock, slCycle, slState } from '../../sl/__tests__/slFixtures.ts';
import {
  clusterSlRowsBySession,
  computePrWorkoutIds,
  groupHistoryByCycle,
  isSlCycle,
} from '../historyGrouping.ts';
import { sessionLabel } from '../../shared/liftLabels.ts';
import { fmtShortDate } from '../../shared/format.ts';

/** Two played sessions, ready to group. */
function playedBlock(): Workout[] {
  let block = playInBlock(slBlock(), 1, { completedAt: '2026-07-12T18:00:00.000Z' });
  block = playInBlock(block, 2, { completedAt: '2026-07-14T18:00:00.000Z' });
  return block;
}

describe('isSlCycle', () => {
  it('tags a block and leaves a classic cycle alone', () => {
    expect(isSlCycle(slCycle(2, slState()))).toBe(true);
    expect(isSlCycle(classicCycle(1))).toBe(false);
  });
});

describe('clusterSlRowsBySession', () => {
  it('clusters the flat rows into sessions, newest session first', () => {
    const groups = groupHistoryByCycle([slCycle(2, slState())], playedBlock());
    const clusters = clusterSlRowsBySession(groups[0]!.rows);
    expect(clusters.map((c) => c.session)).toEqual([2, 1]);
  });

  it('orders each cluster by the slot performance order — squat always first', () => {
    const clusters = clusterSlRowsBySession(
      groupHistoryByCycle([slCycle(2, slState())], playedBlock())[0]!.rows,
    );
    expect(clusters[1]!.rows.map((r) => r.workout.liftId)).toEqual(['squat', 'bench', 'row']);
    expect(clusters[0]!.rows.map((r) => r.workout.liftId)).toEqual(['squat', 'press', 'deadlift']);
  });

  it("builds the 'S05 · A · JUL 12' header from the session tag and its earliest row", () => {
    let block = playInBlock(slBlock(), 5, { completedAt: '2026-07-12T18:00:00.000Z' });
    block = block.map((w) =>
      w.session === 5 && w.liftId === 'row' ? { ...w, completedAt: '2026-07-12T19:00:00.000Z' } : w,
    );
    const clusters = clusterSlRowsBySession(
      groupHistoryByCycle([slCycle(2, slState())], block)[0]!.rows,
    );
    const c = clusters[0]!;
    expect(`${sessionLabel(c.session, c.slot)} · ${fmtShortDate(c.dateKey)}`).toBe('S05 · A · JUL 12');
  });

  it('marks a fully-skipped session and keeps its three rows', () => {
    const block = playInBlock(slBlock(), 4, { status: 'skipped' });
    const clusters = clusterSlRowsBySession(
      groupHistoryByCycle([slCycle(2, slState())], block)[0]!.rows,
    );
    expect(clusters[0]!.skipped).toBe(true);
    expect(clusters[0]!.rows).toHaveLength(3);
  });

  it('ignores rows with no session (classic 5/3/1 workouts)', () => {
    const groups = groupHistoryByCycle([classicCycle(1)], [
      {
        id: 'classic',
        cycleId: 'cycle-1',
        cycleNumber: 1,
        week: 1,
        liftId: 'press',
        status: 'completed',
        tmUsed: 120,
        mainSets: [],
        accessoryWork: [],
        units: 'lb',
        completedAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
    expect(clusterSlRowsBySession(groups[0]!.rows)).toEqual([]);
  });
});

describe('computePrWorkoutIds — StrongLifts efforts and PR epochs', () => {
  it('scores a StrongLifts row on its best logged work set (no AMRAP exists)', () => {
    const block = playInBlock(slBlock(), 1, { completedAt: '2026-07-12T18:00:00.000Z' });
    const ids = computePrWorkoutIds(block);
    // First effort per lift is always a record: squat, bench and row all flag.
    expect(ids.size).toBe(3);
    expect(ids.has('s1-squat')).toBe(true);
  });

  it('restarts the record slate at a reset, without un-flagging pre-reset badges', () => {
    let block = playInBlock(slBlock(), 1, {
      completedAt: '2026-07-12T18:00:00.000Z',
      weights: { squat: 300 },
    });
    // A LIGHTER session after the reset would not normally be a record.
    block = playInBlock(block, 3, {
      completedAt: '2026-08-12T18:00:00.000Z',
      weights: { squat: 200 },
    });

    const unbroken = computePrWorkoutIds(block);
    expect(unbroken.has('s1-squat')).toBe(true);
    expect(unbroken.has('s3-squat')).toBe(false);

    const withReset = computePrWorkoutIds(block, ['2026-08-01T00:00:00.000Z']);
    expect(withReset.has('s1-squat')).toBe(true); // the old badge survives
    expect(withReset.has('s3-squat')).toBe(true); // the new epoch's first is a PR
  });
});
