import { describe, it, expect } from 'vitest';
import { playInBlock, slBlock, slState } from '../../sl/__tests__/slFixtures.ts';
import { buildSlGrid, slAllResolved } from '../cycleGrid.ts';

describe('buildSlGrid — shape', () => {
  it('is 4 week-rows × 3 session-cells, sessions 1..12 in order', () => {
    const grid = buildSlGrid(slBlock(), slState());
    expect(grid.map((r) => r.week)).toEqual([1, 2, 3, 4]);
    expect(grid.every((r) => r.cells.length === 3)).toBe(true);
    expect(grid.flatMap((r) => r.cells.map((c) => c.session))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it('alternates the A/B slot, starting at A', () => {
    const grid = buildSlGrid(slBlock(), slState());
    expect(grid[0]!.cells.map((c) => c.slot)).toEqual(['A', 'B', 'A']);
    expect(grid[1]!.cells.map((c) => c.slot)).toEqual(['B', 'A', 'B']);
  });

  it('renders all twelve cells even before any row exists', () => {
    const grid = buildSlGrid([], undefined);
    expect(grid.flatMap((r) => r.cells)).toHaveLength(12);
    expect(grid[0]!.cells[0]!.squatWeight).toBeNull();
    expect(grid[0]!.cells[0]!.basis).toBe('none');
  });
});

describe('buildSlGrid — statuses', () => {
  it('carries the aggregate session status onto the cell glyph', () => {
    let block = playInBlock(slBlock(), 1);
    block = playInBlock(block, 2, { status: 'skipped' });
    block = playInBlock(block, 3, { status: 'in_progress' });
    const cells = buildSlGrid(block, slState()).flatMap((r) => r.cells);
    expect(cells[0]!.status).toBe('completed');
    expect(cells[1]!.status).toBe('skipped');
    expect(cells[2]!.status).toBe('in_progress');
    expect(cells[3]!.status).toBe('pending');
  });

  it("reports 'mixed' rather than lying when a session's rows disagree", () => {
    const block = slBlock().map((w) =>
      w.session === 1 && w.liftId === 'bench' ? { ...w, status: 'skipped' as const } : w,
    );
    expect(buildSlGrid(block, slState())[0]!.cells[0]!.status).toBe('mixed');
  });
});

describe('buildSlGrid — squat weight, stamped else projected', () => {
  it('projects unstamped cells one squat increment per unresolved session', () => {
    const cells = buildSlGrid(slBlock(), slState()).flatMap((r) => r.cells);
    expect(cells.map((c) => c.squatWeight)).toEqual([
      255, 260, 265, 270, 275, 280, 285, 290, 295, 300, 305, 310,
    ]);
    // Session 1 is the block's live weight, not a forecast; 2-12 are forecasts.
    expect(cells[0]!.basis).toBe('current');
    expect(cells.slice(1).every((c) => c.basis === 'projected')).toBe(true);
  });

  it('shows the frozen weight once a session is stamped, and marks it stamped', () => {
    const block = playInBlock(slBlock(), 1, { weights: { squat: 245 } });
    const cells = buildSlGrid(block, slState({ squat: 260 })).flatMap((r) => r.cells);
    expect(cells[0]!.squatWeight).toBe(245);
    expect(cells[0]!.basis).toBe('stamped');
    // Session 2 is next: no unresolved session precedes it, so it is the exact
    // runtime weight — 'current', never labelled as a forecast.
    expect(cells[1]!.squatWeight).toBe(260);
    expect(cells[1]!.basis).toBe('current');
  });

  it('shows NO weight in a cell skipped before it was ever started', () => {
    // The bug this pins: the cell borrowed the block's LIVE squat weight for a
    // resolved-but-unstamped session and rendered it undimmed (basis 'current'),
    // so a settled historical cell silently re-wrote itself every time a later
    // session progressed the squat. The cell renders '—' on a null weight.
    let block = playInBlock(slBlock(), 1, { status: 'skipped' });
    block = playInBlock(block, 2); // move the runtime on behind it
    const early = buildSlGrid(block, slState({ squat: 275 }))[0]!.cells[0]!;
    expect(early.squatWeight).toBeNull();
    expect(early.basis).toBe('none');

    // ...and it stays null as the block keeps progressing — no retroactive drift.
    const later = buildSlGrid(block, slState({ squat: 310 }))[0]!.cells[0]!;
    expect(later.squatWeight).toBeNull();
  });

  it('keeps the frozen weight when a session was STARTED and then skipped', () => {
    const started = playInBlock(slBlock(), 1, { status: 'in_progress', weights: { squat: 245 } });
    const block = started.map((w) =>
      w.session === 1 ? { ...w, status: 'skipped' as const } : w,
    );
    const cell = buildSlGrid(block, slState({ squat: 310 }))[0]!.cells[0]!;
    expect(cell.squatWeight).toBe(245);
    expect(cell.basis).toBe('stamped');
  });

  it('labels a stamped cell with its row units and an unstamped one with the block units', () => {
    // Session 1 was stamped in lb (255); then the block was switched to kg.
    const block = playInBlock(slBlock(), 1).map((w) =>
      w.session === 1 ? w : { ...w, units: 'kg' as const },
    );
    const cells = buildSlGrid(block, slState({ squat: 117.5 }), 'kg').flatMap((r) => r.cells);
    expect(cells[0]!.squatWeight).toBe(255);
    expect(cells[0]!.units).toBe('lb');
    expect(cells[1]!.basis).toBe('current');
    expect(cells[1]!.units).toBe('kg');
    // A cell with no weight carries no unit either.
    const skipped = buildSlGrid(playInBlock(slBlock(), 1, { status: 'skipped' }), slState(), 'lb');
    expect(skipped[0]!.cells[0]!.units).toBeNull();
  });

  it('gives every cell its three rows for navigation', () => {
    const cell = buildSlGrid(slBlock(), slState())[0]!.cells[0]!;
    expect(cell.workouts.map((w) => w.liftId)).toEqual(['squat', 'bench', 'row']);
  });
});

describe('slAllResolved — the complete-cycle gate over 36 rows', () => {
  it('is false until every one of the twelve sessions is resolved', () => {
    let block = slBlock();
    expect(slAllResolved(block)).toBe(false);
    for (let s = 1; s <= 11; s++) block = playInBlock(block, s);
    expect(slAllResolved(block)).toBe(false);
    block = playInBlock(block, 12, { status: 'skipped' });
    expect(slAllResolved(block)).toBe(true);
  });

  it('refuses to unlock on a truncated block (a session with no rows)', () => {
    let block = slBlock().filter((w) => w.session !== 7);
    for (let s = 1; s <= 12; s++) block = playInBlock(block, s);
    expect(slAllResolved(block)).toBe(false);
  });
});
