import { describe, it, expect } from 'vitest';
import {
  chartGeometry,
  computeYDomain,
  polylinePoints,
  projectPoints,
  projectX,
  projectY,
  stepAfterPath,
  yTicks,
  type ChartPoint,
} from '../chartScale.ts';

describe('chartGeometry', () => {
  it('insets the plot area by the margin on all sides', () => {
    const geo = chartGeometry(300, 160, 12);
    expect(geo.plotLeft).toBe(12);
    expect(geo.plotRight).toBe(288);
    expect(geo.plotTop).toBe(12);
    expect(geo.plotBottom).toBe(148);
    expect(geo.plotWidth).toBe(276);
    expect(geo.plotHeight).toBe(136);
  });

  it('never yields negative plot dimensions for a tiny box', () => {
    const geo = chartGeometry(10, 10, 12);
    expect(geo.plotWidth).toBe(0);
    expect(geo.plotHeight).toBe(0);
  });
});

describe('computeYDomain', () => {
  it('returns a neutral [0,1] domain for no values', () => {
    expect(computeYDomain([])).toEqual({ min: 0, max: 1 });
  });

  it('pads a real span by the pad fraction on each side', () => {
    // span = 100, pad = 10% → 10 on each side
    expect(computeYDomain([100, 200])).toEqual({ min: 90, max: 210 });
  });

  it('builds a symmetric band for a single point (10% of value)', () => {
    // value 200, band = 20
    expect(computeYDomain([200])).toEqual({ min: 180, max: 220 });
  });

  it('builds a symmetric band for an all-equal series', () => {
    expect(computeYDomain([150, 150, 150])).toEqual({ min: 135, max: 165 });
  });

  it('uses a unit band around zero to avoid a zero-width domain', () => {
    expect(computeYDomain([0])).toEqual({ min: -1, max: 1 });
  });
});

describe('projectY', () => {
  const geo = chartGeometry(300, 160, 12);

  it('maps the domain max to the top and the min to the bottom (inverted)', () => {
    const domain = { min: 100, max: 200 };
    expect(projectY(200, domain, geo)).toBeCloseTo(geo.plotTop, 6);
    expect(projectY(100, domain, geo)).toBeCloseTo(geo.plotBottom, 6);
    expect(projectY(150, domain, geo)).toBeCloseTo(geo.plotTop + geo.plotHeight / 2, 6);
  });

  it('centres everything vertically for a degenerate domain', () => {
    const domain = { min: 150, max: 150 };
    expect(projectY(150, domain, geo)).toBeCloseTo(geo.plotTop + geo.plotHeight / 2, 6);
  });
});

describe('projectX', () => {
  const geo = chartGeometry(300, 160, 12);

  it('centres a single point horizontally', () => {
    expect(projectX(0, 1, geo)).toBeCloseTo(geo.plotLeft + geo.plotWidth / 2, 6);
  });

  it('spreads indices from plotLeft to plotRight', () => {
    expect(projectX(0, 3, geo)).toBeCloseTo(geo.plotLeft, 6);
    expect(projectX(2, 3, geo)).toBeCloseTo(geo.plotRight, 6);
    expect(projectX(1, 3, geo)).toBeCloseTo(geo.plotLeft + geo.plotWidth / 2, 6);
  });
});

describe('projectPoints', () => {
  it('projects a series and centres a single point', () => {
    const geo = chartGeometry(300, 160, 12);
    const one: ChartPoint[] = [{ x: 0, y: 100 }];
    const proj = projectPoints(one, computeYDomain([100]), geo);
    expect(proj).toHaveLength(1);
    expect(proj[0]!.cx).toBeCloseTo(geo.plotLeft + geo.plotWidth / 2, 6);
    // single point sits on the vertical centre of its band
    expect(proj[0]!.cy).toBeCloseTo(geo.plotTop + geo.plotHeight / 2, 6);
  });

  it('handles a 50+ point series without error and stays within the plot', () => {
    const geo = chartGeometry(300, 160, 12);
    const pts: ChartPoint[] = Array.from({ length: 60 }, (_, i) => ({ x: i, y: 100 + i }));
    const domain = computeYDomain(pts.map((p) => p.y));
    const proj = projectPoints(pts, domain, geo);
    expect(proj).toHaveLength(60);
    for (const p of proj) {
      expect(p.cx).toBeGreaterThanOrEqual(geo.plotLeft - 1e-6);
      expect(p.cx).toBeLessThanOrEqual(geo.plotRight + 1e-6);
      expect(p.cy).toBeGreaterThanOrEqual(geo.plotTop - 1e-6);
      expect(p.cy).toBeLessThanOrEqual(geo.plotBottom + 1e-6);
    }
  });
});

describe('yTicks', () => {
  it('produces evenly spaced inclusive ticks', () => {
    expect(yTicks({ min: 0, max: 100 }, 5)).toEqual([0, 25, 50, 75, 100]);
  });

  it('collapses to the two endpoints when count <= 1', () => {
    expect(yTicks({ min: 10, max: 20 }, 1)).toEqual([10, 20]);
  });

  it('returns a single tick for a degenerate domain', () => {
    expect(yTicks({ min: 5, max: 5 }, 4)).toEqual([5]);
  });
});

describe('polylinePoints', () => {
  it('joins projected points into an SVG points string', () => {
    expect(
      polylinePoints([
        { cx: 12, cy: 40 },
        { cx: 60.005, cy: 30 },
      ]),
    ).toBe('12,40 60.01,30');
  });
});

describe('stepAfterPath', () => {
  it('returns empty for no points', () => {
    expect(stepAfterPath([])).toBe('');
  });

  it('holds each value until the next x, then jumps (step-after)', () => {
    const d = stepAfterPath([
      { cx: 0, cy: 100 },
      { cx: 50, cy: 60 },
    ]);
    // Move to first, horizontal at old y to new x, then vertical to new y.
    expect(d).toBe('M 0 100 L 50 100 L 50 60');
  });
});
