// The SELECTION WIRING suite: Today, the cycle grid and the session screen all
// choose "the session you may act on" the same way, by feeding the repo's
// `earliestUnresolvedSlSession` into the view layer's `slSessionMode`. This file
// pins that seam — a second, drifting definition of "current" is the bug it
// exists to prevent.
//
// `fake-indexeddb/auto` is imported for its side effects BEFORE slRepo, because
// importing the repo evaluates `new Dexie()`. No database is actually used:
// `earliestUnresolvedSlSession` is a pure function over rows.
import 'fake-indexeddb/auto';

import { describe, it, expect } from 'vitest';
import { playInBlock, slBlock, slState } from './slFixtures.ts';
import { earliestUnresolvedSlSession } from '../../../db/repo/slRepo.ts';
import { buildSlSessionView, slSessionMode } from '../slView.ts';

describe('next-session selection (earliestUnresolvedSlSession → slSessionMode)', () => {
  it('starts at session 1 on a fresh block', () => {
    expect(earliestUnresolvedSlSession(slBlock())).toBe(1);
  });

  it('advances past completed AND skipped sessions alike', () => {
    let block = playInBlock(slBlock(), 1);
    expect(earliestUnresolvedSlSession(block)).toBe(2);
    block = playInBlock(block, 2, { status: 'skipped' });
    expect(earliestUnresolvedSlSession(block)).toBe(3);
  });

  it('stays on an in_progress session — a resume, not an advance', () => {
    const block = playInBlock(slBlock(), 1, { status: 'in_progress' });
    expect(earliestUnresolvedSlSession(block)).toBe(1);
  });

  it('is null once every session is resolved — the block-complete signal', () => {
    let block = slBlock();
    for (let s = 1; s <= 12; s++) block = playInBlock(block, s);
    expect(earliestUnresolvedSlSession(block)).toBeNull();
  });

  it('never skips a hole: an out-of-order resolved session does not move the cursor', () => {
    // Session 5 resolved while 1 is still pending (only reachable via import).
    const block = playInBlock(slBlock(), 5);
    expect(earliestUnresolvedSlSession(block)).toBe(1);
  });
});

describe('the wiring the screens perform', () => {
  it('makes exactly ONE session loggable and every later one view-only', () => {
    let block = playInBlock(slBlock(), 1);
    block = playInBlock(block, 2);
    const current = earliestUnresolvedSlSession(block);
    expect(current).toBe(3);

    const modes: string[] = [];
    for (let s = 1; s <= 12; s++) {
      modes.push(slSessionMode(s, current, block.filter((w) => w.session === s)));
    }
    expect(modes.filter((m) => m === 'log')).toHaveLength(1);
    expect(modes.slice(0, 2)).toEqual(['resolved', 'resolved']);
    expect(modes[2]).toBe('log');
    expect(modes.slice(3).every((m) => m === 'projected')).toBe(true);
  });

  it('shows the loggable session at its true runtime weight and later ones projected', () => {
    let block = playInBlock(slBlock(), 1);
    block = playInBlock(block, 2);
    const current = earliestUnresolvedSlSession(block)!;
    // Two passes moved squat 255 → 265 in the runtime.
    const sl = slState({ squat: 265 });

    const now = buildSlSessionView(block, current, sl);
    expect(now.lifts.find((l) => l.liftId === 'squat')!.weight).toBe(265);
    expect(now.lifts.every((l) => l.basis === 'current')).toBe(true);

    const later = buildSlSessionView(block, current + 2, sl);
    expect(later.lifts.find((l) => l.liftId === 'squat')!.weight).toBe(275);
    expect(later.lifts.every((l) => l.basis === 'projected')).toBe(true);
  });
});
