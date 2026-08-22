import { describe, it, expect } from 'vitest';
import type { LiftId } from '../../../core/types.ts';
import { slReturnTmSuggestions, slSwitchInSuggestions } from '../../../core/sl.ts';
import { playInBlock, slBlock } from './slFixtures.ts';
import {
  KEEP_PRS_OFF_COPY,
  KEEP_PRS_ON_COPY,
  SL_ROW_START_COPY,
  SL_SWITCH_IN_WEIGHT_COPY,
  bestSlEffortsByLift,
  keepPrsCopy,
  slDeadliftIncrementCopy,
  slReturnBasisCopy,
} from '../slView.ts';

describe('switch-IN copy', () => {
  it('explains the 85% suggestion and the fresh row', () => {
    expect(SL_SWITCH_IN_WEIGHT_COPY).toBe(
      '≈85% of your training max — the classic 5×5 grind zone. Edit freely.',
    );
    expect(SL_ROW_START_COPY).toContain('Barbell Row starts fresh');
    expect(SL_ROW_START_COPY).toContain('StrongLifts says start light');
  });

  it('states the deadlift canon in the UNITS THE USER LIFTS IN', () => {
    expect(slDeadliftIncrementCopy('lb')).toBe(
      '+10 per session while it progresses easily — StrongLifts canon. Drop to +5 when it slows.',
    );
    expect(slDeadliftIncrementCopy('kg')).toBe(
      '+5 per session while it progresses easily — StrongLifts canon. Drop to +2.5 when it slows.',
    );
  });

  it('pairs the copy with the suggestion it describes (85% of TM, rounded)', () => {
    const tms: Record<LiftId, number> = { press: 120, bench: 200, squat: 300, deadlift: 350 };
    expect(slSwitchInSuggestions(tms, 5)).toEqual({
      press: 100,
      bench: 170,
      squat: 255,
      deadlift: 300,
    });
  });
});

describe('keep-PRs copy', () => {
  it('says something different, and true, for each position of the toggle', () => {
    expect(keepPrsCopy(true)).toBe(KEEP_PRS_ON_COPY);
    expect(keepPrsCopy(false)).toBe(KEEP_PRS_OFF_COPY);
    expect(KEEP_PRS_ON_COPY).toBe(
      'One record book. Your 5/3/1 records stand; a big 5×5 set can beat them.',
    );
    expect(KEEP_PRS_OFF_COPY).toBe('Records restart at the switch. Old PR badges stay in History.');
  });
});

describe('switch-BACK basis copy', () => {
  it('names the very set that justified a raised TM', () => {
    expect(slReturnBasisCopy('sl-e1rm', { weight: 205, reps: 5, e1rm: 239.2 })).toBe(
      '90% of your best 5×5 e1RM (205×5)',
    );
  });

  it('says plainly when the block did not beat the old TM', () => {
    expect(slReturnBasisCopy('current-tm', { weight: 100, reps: 5, e1rm: 116 })).toBe(
      "keeping your previous TM — your 5×5 block didn't exceed it",
    );
    // Total even with no effort at all.
    expect(slReturnBasisCopy('sl-e1rm', undefined)).toContain('keeping your previous TM');
  });

  it('wires bestSlEffortsByLift into slReturnTmSuggestions end to end', () => {
    // Bench 205×5 → e1RM 239.2 → 90% = 215.28 → 215 beats a 200 TM.
    // Squat 240×5 → e1RM 280 → 90% = 252 → 250 does NOT beat a 265 TM.
    let block = playInBlock(slBlock(), 1, {
      weights: { bench: 205, squat: 240 },
      completedAt: '2026-07-12T18:00:00.000Z',
    });
    block = block.filter((w) => w.session === 1);

    const best = bestSlEffortsByLift(block, 'lb');
    const currentTms: Record<LiftId, number> = {
      press: 120,
      bench: 200,
      squat: 265,
      deadlift: 350,
    };
    const bestE1rms: Record<LiftId, number | null> = {
      press: best.press?.e1rm ?? null,
      bench: best.bench?.e1rm ?? null,
      squat: best.squat?.e1rm ?? null,
      deadlift: best.deadlift?.e1rm ?? null,
    };
    const suggestions = slReturnTmSuggestions(currentTms, bestE1rms, 5);

    const bench = suggestions.find((s) => s.liftId === 'bench')!;
    expect(bench.suggestedTm).toBe(215);
    expect(slReturnBasisCopy(bench.basis, best.bench)).toBe('90% of your best 5×5 e1RM (205×5)');

    const squat = suggestions.find((s) => s.liftId === 'squat')!;
    expect(squat.suggestedTm).toBe(265); // never lowers the TM
    expect(slReturnBasisCopy(squat.basis, best.squat)).toContain('keeping your previous TM');

    // Session 1 is slot A, so the press never lifted — it keeps its TM.
    const press = suggestions.find((s) => s.liftId === 'press')!;
    expect(press.suggestedTm).toBe(120);
    expect(press.basis).toBe('current-tm');
  });
});
