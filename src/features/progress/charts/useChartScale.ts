import { useMemo } from 'react';
import {
  chartGeometry,
  computeYDomain,
  projectPoints,
  type ChartGeometry,
  type ChartPoint,
  type ProjectedPoint,
  type YDomain,
} from './chartScale.ts';

/** The projected series + geometry a chart component needs to render. */
export interface ChartScale {
  geo: ChartGeometry;
  domain: YDomain;
  projected: ProjectedPoint[];
}

/**
 * Thin React wrapper over the pure scale math: memoises geometry, y-domain, and
 * the projected points for a series. All the arithmetic lives in chartScale.ts
 * (React-free, unit-tested); this hook only wires it into render.
 */
export function useChartScale(
  points: readonly ChartPoint[],
  width?: number,
  height?: number,
  margin?: number,
): ChartScale {
  return useMemo(() => {
    const geo = chartGeometry(width, height, margin);
    const domain = computeYDomain(points.map((p) => p.y));
    const projected = projectPoints(points, domain, geo);
    return { geo, domain, projected };
  }, [points, width, height, margin]);
}
