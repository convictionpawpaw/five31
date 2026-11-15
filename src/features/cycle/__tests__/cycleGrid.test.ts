import { describe, it, expect } from 'vitest';
import type { LiftId, MainSet, Workout, WorkoutStatus, WeekNumber } from '../../../core/types.ts';
import { DAY_ORDER } from '../../../core/scheme.ts';
import { allResolved, buildGrid, deloadRemovable, hasDeload } from '../cycleGrid.ts';

function work(index: number, weight: number): MainSet {
  return { kind: 'work', index, percent: 0.85, weight, targetReps: 5, amrap: index === 2 };
}

function mk(week: WeekNumber, liftId: LiftId, status: WorkoutStatus): Workout {
  return {
    id: `${week}-${liftId}`,
    cycleId: 'c1',
    cycleNumber: 1,
    week,
    liftId,
    status,
    tmUsed: 200,
    mainSets: [work(0, 130), work(1, 150), work(2, 170)],
    accessoryWork: [],
    units: 'lb',
  };
}

/** A full 3-week cycle (12 workouts), all pending. */
function fullCycle(withDeload = false): Workout[] {
  const weeks: WeekNumber[] = withDeload ? [1, 2, 3, 4] : [1, 2, 3];
  const out: Workout[] = [];
  for (const week of weeks) {
    for (const liftId of DAY_ORDER) out.push(mk(week, liftId, 'pending'));
  }
  return out;
}

describe('buildGrid', () => {
  it('produces one row per week and DAY_ORDER columns', () => {
    const grid = buildGrid(fullCycle());
    expect(grid.map((r) => r.week)).toEqual([1, 2, 3]);
    expect(grid[0]!.cells.map((c) => c.liftId)).toEqual([...DAY_ORDER]);
    expect(grid[0]!.cells[0]!.topWeight).toBe(170); // last work set weight
  });

  it("labels each cell with its workout row's OWN units, not the settings unit", () => {
    // Mid-cycle lb → kg switch: the completed week-1 press keeps lb + 255; the
    // regenerated pending rows are kg.
    const c = fullCycle().map((w) =>
      w.week === 1 && w.liftId === 'press'
        ? { ...mk(1, 'press', 'completed'), mainSets: [work(0, 195), work(1, 225), work(2, 255)] }
        : { ...w, units: 'kg' as const, mainSets: [work(0, 60), work(1, 70), work(2, 77.5)] },
    );
    const grid = buildGrid(c);
    const press1 = grid[0]!.cells.find((cell) => cell.liftId === 'press')!;
    expect(press1.topWeight).toBe(255);
    expect(press1.units).toBe('lb');
    const bench1 = grid[0]!.cells.find((cell) => cell.liftId === 'bench')!;
    expect(bench1.units).toBe('kg');
  });

  it('adds the deload row when present, sorted last', () => {
    const grid = buildGrid(fullCycle(true));
    expect(grid.map((r) => r.week)).toEqual([1, 2, 3, 4]);
  });
});

describe('hasDeload / deloadRemovable', () => {
  it('detects a deload week', () => {
    expect(hasDeload(fullCycle())).toBe(false);
    expect(hasDeload(fullCycle(true))).toBe(true);
  });

  it('is removable only while every week-4 workout is pending', () => {
    const c = fullCycle(true);
    expect(deloadRemovable(c)).toBe(true);
    const started = c.map((w) => (w.week === 4 && w.liftId === 'press' ? mk(4, 'press', 'completed') : w));
    expect(deloadRemovable(started)).toBe(false);
  });
});

describe('allResolved', () => {
  it('is true only when every workout is completed or skipped', () => {
    const resolved = fullCycle().map((w) => ({ ...w, status: 'completed' as WorkoutStatus }));
    expect(allResolved(resolved)).toBe(true);
    expect(allResolved(fullCycle())).toBe(false);
    expect(allResolved([])).toBe(false);
  });
});
