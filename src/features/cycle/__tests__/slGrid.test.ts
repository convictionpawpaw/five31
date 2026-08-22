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
