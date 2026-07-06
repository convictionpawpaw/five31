import { describe, it, expect } from 'vitest';
import type { Cycle, LiftId } from '../../../core/types.ts';
import { buildTmStepSeries } from '../progressData.ts';
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
