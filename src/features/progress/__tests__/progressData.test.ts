import { describe, it, expect } from 'vitest';
import type { AccessoryWork, Cycle, LiftId, Units, Workout } from '../../../core/types.ts';
import { convertWeight } from '../../../core/units.ts';
import {
  accessorySparklineValues,
  buildAccessorySeries,
  buildBodyweightSeries,
  buildTmStepSeries,
} from '../progressData.ts';
import {
  chartGeometry,
  computeYDomain,
  projectPoints,
} from '../charts/chartScale.ts';

/** Build a minimal completed/active cycle carrying a per-lift TM snapshot. */
function cycle(number: number, tm: number): Cycle {
  const tms = { press: tm, bench: tm, squat: tm, deadlift: tm } as Record<LiftId, number>;
  return {
    id: `cycle-${number}`,
    number,
    status: number === 3 ? 'active' : 'completed',
    startedAt: `2026-0${number}-01T00:00:00.000Z`,
    tms,
    includeDeload: false,
    units: 'lb',
  };
}

describe('buildTmStepSeries (finding 6: x must be a 0-based index)', () => {
  it('maps x to the array index, not the 1-based cycle number', () => {
    const cycles = [cycle(1, 100), cycle(2, 105), cycle(3, 110)];
    const series = buildTmStepSeries(cycles, 'press', 'lb');
    expect(series.points.map((p) => p.x)).toEqual([0, 1, 2]);
    // The cycle identity survives on the label.
    expect(series.points.map((p) => p.label)).toEqual(['C1', 'C2', 'C3']);
  });

  it('projects the LAST (newest) TM point exactly onto plotRight — never off-canvas', () => {
    const geo = chartGeometry(300, 160, 12);
    for (const cycles of [
      [cycle(1, 100), cycle(2, 110)],
      [cycle(1, 100), cycle(2, 105), cycle(3, 110)],
    ]) {
      const series = buildTmStepSeries(cycles, 'press', 'lb');
      const domain = computeYDomain(series.points.map((p) => p.y));
      const projected = projectPoints(series.points, domain, geo);
      const last = projected[projected.length - 1]!;
      // The most important point (current cycle's TM) must sit at the right edge
      // of the plot, strictly inside the viewBox — not beyond plotRight.
      expect(last.cx).toBeCloseTo(geo.plotRight, 6);
      for (const p of projected) {
        expect(p.cx).toBeGreaterThanOrEqual(geo.plotLeft - 1e-6);
        expect(p.cx).toBeLessThanOrEqual(geo.plotRight + 1e-6);
      }
    }
  });

  it('latest stat reflects the newest cycle', () => {
    const cycles = [cycle(1, 100), cycle(2, 105), cycle(3, 110)];
    const series = buildTmStepSeries(cycles, 'press', 'lb');
    expect(series.latest).toEqual({ value: 110, units: 'lb' });
  });
});

function accWorkout(id: string, completedAt: string, weight: number, units: Units): Workout {
  const acc: AccessoryWork = {
    accessoryId: 'dips',
    name: 'Dips',
    weight,
    targetSets: 3,
    repRangeMin: 8,
    repRangeMax: 12,
    setReps: [12, 12, 12],
    progressed: false,
  };
  return {
    id,
    cycleId: 'c1',
    cycleNumber: 1,
    week: 1,
    liftId: 'bench',
    status: 'completed',
    tmUsed: 200,
    mainSets: [],
    accessoryWork: [acc],
    units,
    completedAt,
  };
}

describe('accessorySparklineValues — converts like the full accessory chart', () => {
  it('puts every point in the target units across a mid-history unit switch', () => {
    const ws = [
      accWorkout('a', '2026-07-01T10:00:00.000Z', 100, 'lb'),
      accWorkout('b', '2026-07-08T10:00:00.000Z', 105, 'lb'),
      accWorkout('c', '2026-07-15T10:00:00.000Z', 47.5, 'kg'),
    ];
    const spark = accessorySparklineValues(ws, 'dips', 'kg');
    expect(spark).toEqual([
      convertWeight(100, 'lb', 'kg'),
      convertWeight(105, 'lb', 'kg'),
      47.5,
    ]);
    // Identical to the full chart's y values.
    expect(spark).toEqual(buildAccessorySeries(ws, 'dips', 'kg').points.map((p) => p.y));
    // Last-N still applies.
    expect(accessorySparklineValues(ws, 'dips', 'lb', 2)).toEqual([105, convertWeight(47.5, 'kg', 'lb')]);
  });
});

describe('buildBodyweightSeries — date labels', () => {
  it('labels a date-only entry with its own calendar day', () => {
    const series = buildBodyweightSeries(
      [{ id: 'b1', date: '2026-07-01', weight: 180, units: 'lb' }],
      'lb',
    );
    expect(series.points[0]!.label).toBe('JUL 1');
  });
});
