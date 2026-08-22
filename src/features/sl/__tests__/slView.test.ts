import { describe, it, expect } from 'vitest';
import {
  WEIGHTS,
  classicCycle,
  playInBlock,
  slBlock,
  slCycle,
  slState,
} from './slFixtures.ts';
import {
  bestSlEffortsByLift,
  buildSlSessionView,
  canUnskipSlSession,
  countUnloggedSlSets,
  lastCompletedSlSession,
  latestSlRowWeight,
  previewSlLiftOutcome,
  slOccurrencesBefore,
  slOutcomeCopy,
  slSessionMode,
  slSessionRows,
  slSessionStatus,
  slStreakPips,
} from '../slView.ts';
import { slSessionHeading } from '../../shared/liftLabels.ts';

describe('slSessionRows', () => {
  it('returns the three rows in performance order — squat first, both slots', () => {
    const block = slBlock();
    expect(slSessionRows(block, 1).map((w) => w.liftId)).toEqual(['squat', 'bench', 'row']);
    expect(slSessionRows(block, 2).map((w) => w.liftId)).toEqual(['squat', 'press', 'deadlift']);
  });

  it('does not throw on a malformed session — it yields what exists', () => {
    const partial = slBlock().filter((w) => !(w.session === 3 && w.liftId === 'row'));
    expect(slSessionRows(partial, 3).map((w) => w.liftId)).toEqual(['squat', 'bench']);
  });
});

describe('slSessionStatus', () => {
  it('reports the uniform status of the three rows', () => {
    const block = playInBlock(slBlock(), 1);
    expect(slSessionStatus(slSessionRows(block, 1))).toBe('completed');
    expect(slSessionStatus(slSessionRows(block, 2))).toBe('pending');
  });

  it("reports 'mixed' when rows disagree, and 'pending' for an absent session", () => {
    const block = slBlock().map((w) =>
      w.session === 4 && w.liftId === 'squat' ? { ...w, status: 'skipped' as const } : w,
    );
    expect(slSessionStatus(slSessionRows(block, 4))).toBe('mixed');
    expect(slSessionStatus([])).toBe('pending');
  });
});

describe('slOccurrencesBefore', () => {
  it('counts only UNRESOLVED earlier sessions that train the lift', () => {
    const block = slBlock();
    // Squat trains every session: 4 unresolved sessions precede session 5.
    expect(slOccurrencesBefore(block, 5, 'squat')).toBe(4);
    // The row only trains slot A (odd sessions): sessions 1 and 3 precede 5.
    expect(slOccurrencesBefore(block, 5, 'row')).toBe(2);
    // The deadlift only trains slot B (even): sessions 2 and 4 precede 5.
    expect(slOccurrencesBefore(block, 5, 'deadlift')).toBe(2);
  });

  it('excludes resolved sessions — their progression is already in the runtime', () => {
    let block = playInBlock(slBlock(), 1);
    block = playInBlock(block, 2, { status: 'skipped' });
    expect(slOccurrencesBefore(block, 5, 'squat')).toBe(2); // sessions 3 and 4 only
  });
});

describe('buildSlSessionView', () => {
  it('shows the runtime weight for the CURRENT pending session (no projection drift)', () => {
    const view = buildSlSessionView(slBlock(), 1, slState());
    expect(view.slot).toBe('A');
    expect(view.week).toBe(1);
    expect(view.lifts.map((l) => l.liftId)).toEqual(['squat', 'bench', 'row']);
    expect(view.lifts.map((l) => l.weight)).toEqual([255, 170, 135]);
    // Unstamped but EXACT — never labelled a forecast.
    expect(view.lifts.every((l) => l.basis === 'current')).toBe(true);
  });

  it('projects a LATER session forward by one increment per unresolved occurrence', () => {
    const view = buildSlSessionView(slBlock(), 5, slState());
    // squat: 255 + 4×5 = 275 ; bench: 170 + 2×5 = 180 ; row: 135 + 2×5 = 145
    expect(view.lifts.map((l) => l.weight)).toEqual([275, 180, 145]);
    expect(view.lifts.every((l) => l.basis === 'projected')).toBe(true);
    // Deadlift lives in slot B and increments by 10: session 6 → 300 + 2×10.
    const b = buildSlSessionView(slBlock(), 6, slState());
    expect(b.lifts.find((l) => l.liftId === 'deadlift')!.weight).toBe(320);
  });

  it('prefers the STAMPED weight over any projection once the session has started', () => {
    const block = playInBlock(slBlock(), 1, { status: 'in_progress', weights: { squat: 999 } });
    const view = buildSlSessionView(block, 1, slState());
    const squat = view.lifts[0]!;
    expect(squat.basis).toBe('stamped');
    expect(squat.weight).toBe(999);
    expect(squat.sets).toHaveLength(5);
    expect(squat.allLogged).toBe(true);
  });

  it('builds a 5×5 preview for every lift but the deadlift, which is 1×5', () => {
    const view = buildSlSessionView(slBlock(), 2, slState());
    expect(view.lifts.map((l) => l.sets.length)).toEqual([5, 5, 1]);
    expect(view.lifts.every((l) => l.sets.every((s) => s.targetReps === 5 && !s.amrap))).toBe(true);
  });
});

describe('slSessionMode', () => {
  it('is log for the current session, projected for later ones, resolved for done ones', () => {
    const block = playInBlock(slBlock(), 1);
    expect(slSessionMode(1, 2, slSessionRows(block, 1))).toBe('resolved');
    expect(slSessionMode(2, 2, slSessionRows(block, 2))).toBe('log');
    expect(slSessionMode(3, 2, slSessionRows(block, 3))).toBe('projected');
  });

  it('never returns log once the block is fully resolved (currentSession null)', () => {
    expect(slSessionMode(12, null, slSessionRows(slBlock(), 12))).toBe('projected');
  });
});

describe('canUnskipSlSession', () => {
  it('allows un-skip only while every LATER session is still pending', () => {
    const skipped = playInBlock(slBlock(), 3, { status: 'skipped' });
    expect(canUnskipSlSession(skipped, 3)).toBe(true);
    const laterStarted = playInBlock(skipped, 4, { status: 'in_progress' });
    expect(canUnskipSlSession(laterStarted, 3)).toBe(false);
  });

  it('is false for a session that was completed rather than skipped', () => {
    expect(canUnskipSlSession(playInBlock(slBlock(), 3), 3)).toBe(false);
  });
});

describe('countUnloggedSlSets', () => {
  it('counts an UNSTAMPED row as all of its sets unlogged (they count as misses)', () => {
    // Session 2 is A→B: squat 5 + press 5 + deadlift 1 = 11 sets.
    expect(countUnloggedSlSets(slSessionRows(slBlock(), 2))).toBe(11);
  });

  it('counts only the genuinely unlogged sets of a stamped session', () => {
    const block = playInBlock(slBlock(), 1, { status: 'in_progress' });
    const partial = block.map((w) =>
      w.session === 1 && w.liftId === 'row'
        ? { ...w, mainSets: w.mainSets.map((s, i) => (i < 2 ? s : { ...s, actualReps: undefined })) }
        : w,
    );
    expect(countUnloggedSlSets(slSessionRows(partial, 1))).toBe(3);
  });
});

describe('lastCompletedSlSession', () => {
  it('is the highest fully-completed session, ignoring skipped ones', () => {
    let block = playInBlock(slBlock(), 1);
    block = playInBlock(block, 2);
    block = playInBlock(block, 3, { status: 'skipped' });
    expect(lastCompletedSlSession(block)).toBe(2);
    expect(lastCompletedSlSession(slBlock())).toBeNull();
  });
});

describe('previewSlLiftOutcome + slOutcomeCopy (the three copy variants)', () => {
  const inc5 = { weight: 225, increment: 5, failStreak: 0 };

  it('pass → "230 next session (+5)"', () => {
    const sets = [{ kind: 'work' as const, index: 0, percent: 1, weight: 225, targetReps: 5, amrap: false, actualReps: 5 }];
    const o = previewSlLiftOutcome('squat', inc5, sets, 5);
    expect(o.passed).toBe(true);
    expect(o.after.weight).toBe(230);
    expect(slOutcomeCopy(o)).toBe('230 next session (+5)');
  });

  it('miss with streak < 2 → "Repeat 185 next session (miss 1 of 3)"', () => {
    const before = { weight: 185, increment: 5, failStreak: 0 };
    const sets = [{ kind: 'work' as const, index: 0, percent: 1, weight: 185, targetReps: 5, amrap: false, actualReps: 3 }];
    const o = previewSlLiftOutcome('bench', before, sets, 5);
    expect(o.deloaded).toBe(false);
    expect(slOutcomeCopy(o)).toBe('Repeat 185 next session (miss 1 of 3)');
    // Second miss counts up rather than resetting.
    const second = previewSlLiftOutcome('bench', { ...before, failStreak: 1 }, sets, 5);
    expect(slOutcomeCopy(second)).toBe('Repeat 185 next session (miss 2 of 3)');
  });

  it('third consecutive miss → "Deload: 185 → 165 next session (−10%)"', () => {
    const before = { weight: 185, increment: 5, failStreak: 2 };
    const sets = [{ kind: 'work' as const, index: 0, percent: 1, weight: 185, targetReps: 5, amrap: false, actualReps: 3 }];
    const o = previewSlLiftOutcome('bench', before, sets, 5);
    expect(o.deloaded).toBe(true);
    expect(o.after.weight).toBe(165); // 166.5 → 165 on the lb/5 grid
    expect(o.after.failStreak).toBe(0);
    expect(slOutcomeCopy(o)).toBe('Deload: 185 → 165 next session (−10%)');
  });

  it('treats an UNLOGGED set as a miss — the finish warning is truthful', () => {
    const sets = [
      { kind: 'work' as const, index: 0, percent: 1, weight: 225, targetReps: 5, amrap: false, actualReps: 5 },
      { kind: 'work' as const, index: 1, percent: 1, weight: 225, targetReps: 5, amrap: false },
    ];
    expect(previewSlLiftOutcome('squat', inc5, sets, 5).passed).toBe(false);
  });
});

describe('slStreakPips', () => {
  it('fills one pip per miss, out of the three that trigger a deload', () => {
    expect(slStreakPips(0)).toEqual([false, false, false]);
    expect(slStreakPips(2)).toEqual([true, true, false]);
  });
});

describe('bestSlEffortsByLift', () => {
  it('takes the highest-e1RM logged work set per lift across completed SL rows', () => {
    let block = playInBlock(slBlock(), 1, { reps: { squat: 5 } });
    block = playInBlock(block, 3, { reps: { squat: 8 }, weights: { squat: 265 } });
    const best = bestSlEffortsByLift(block, 'lb');
    expect(best.squat!.weight).toBe(265);
    expect(best.squat!.reps).toBe(8);
    expect(best.squat!.e1rm).toBeCloseTo(265 * (1 + 8 / 30), 1);
    expect(best.row!.weight).toBe(WEIGHTS.row);
  });

  it('ignores classic 5/3/1 rows and un-completed StrongLifts sessions', () => {
    const inProgress = playInBlock(slBlock(), 1, { status: 'in_progress' });
    expect(bestSlEffortsByLift(inProgress, 'lb')).toEqual({});
  });
});

describe('latestSlRowWeight', () => {
  it('carries the row weight forward from the most recent prior block', () => {
    const cycles = [
      classicCycle(1),
      slCycle(2, slState({ row: 120 }), 'completed'),
      slCycle(4, slState({ row: 150 }), 'completed'),
      slCycle(3, slState({ row: 135 }), 'completed'),
    ];
    expect(latestSlRowWeight(cycles)).toBe(150);
  });

  it('is null when the row has never been trained', () => {
    expect(latestSlRowWeight([classicCycle(1)])).toBeNull();
  });
});

describe('slSessionHeading (week 4 is NOT a deload)', () => {
  it('renders the long session header', () => {
    expect(slSessionHeading(5, 'A', 2)).toBe('SESSION 05 · A · WEEK 2');
  });

  it('never says DELOAD for week 4 — sessions 10-12 are an ordinary fourth week', () => {
    expect(slSessionHeading(10, 'B', 4)).toBe('SESSION 10 · B · WEEK 4');
  });
});
