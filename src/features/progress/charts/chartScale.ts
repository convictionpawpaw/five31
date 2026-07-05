/**
 * Pure scale / tick math for the hand-rolled SVG charts. React-free so it can be
 * unit-tested in isolation (see chartScale.test.ts).
 *
 * Charts draw into a fixed viewBox (default 300×160 user units) and scale to
 * their container via `preserveAspectRatio`, so nothing here deals in pixels.
 */

/** One data point: an x index (0-based position) and a y value. */
export interface ChartPoint {
  /** Chronological index (0..n-1). */
  x: number;
  /** Value on the y axis. */
  y: number;
}

/** A projected point in viewBox user-space (top-left origin, y grows downward). */
export interface ProjectedPoint {
  cx: number;
  cy: number;
}

/** The plot geometry: inner drawing area inset from the viewBox by a margin. */
export interface ChartGeometry {
  /** Full viewBox width/height. */
  width: number;
  height: number;
  /** Uniform inner margin (padding) around the plot area. */
  margin: number;
  /** Plot-area bounds (viewBox minus margins). */
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  plotWidth: number;
  plotHeight: number;
}

/** Default chart viewBox dimensions (user units, not pixels). */
export const CHART_WIDTH = 300;
export const CHART_HEIGHT = 160;
export const CHART_MARGIN = 12;

/** Build the plot geometry for a viewBox + uniform margin. */
export function chartGeometry(
  width = CHART_WIDTH,
  height = CHART_HEIGHT,
  margin = CHART_MARGIN,
): ChartGeometry {
  const plotLeft = margin;
  const plotRight = width - margin;
  const plotTop = margin;
  const plotBottom = height - margin;
  return {
    width,
    height,
    margin,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    plotWidth: Math.max(0, plotRight - plotLeft),
    plotHeight: Math.max(0, plotBottom - plotTop),
  };
}

/** A y-domain [min, max] after padding, guaranteed to be non-degenerate. */
export interface YDomain {
  min: number;
  max: number;
}

/**
 * Compute a padded y-domain for a set of values.
 *
 *  - Empty input → a neutral [0, 1] domain.
 *  - All-equal input (or a single point) → a symmetric band around the value so
 *    a flat/single series still renders on a visible mid-line (never divide by
 *    zero). For a value of 0 the band is [-1, 1]; otherwise ±10% of |value|.
 *  - Otherwise → [min, max] expanded by `padFraction` of the span on each side.
 */
export function computeYDomain(values: readonly number[], padFraction = 0.1): YDomain {
  if (values.length === 0) return { min: 0, max: 1 };

  let min = values[0]!;
  let max = values[0]!;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const span = max - min;
  if (span <= 0) {
    // Flat or single-point series: build a symmetric visible band.
    const band = Math.abs(max) > 0 ? Math.abs(max) * padFraction : 1;
    return { min: min - band, max: max + band };
  }

  const pad = span * padFraction;
  return { min: min - pad, max: max + pad };
}

/**
 * Project a value on the y axis into a viewBox y-coordinate (inverted: the
 * domain max maps to plotTop, the domain min to plotBottom). A degenerate domain
 * (min === max) maps everything to the vertical centre of the plot.
 */
export function projectY(value: number, domain: YDomain, geo: ChartGeometry): number {
  const range = domain.max - domain.min;
  if (range <= 0) return geo.plotTop + geo.plotHeight / 2;
  const t = (value - domain.min) / range;
  // t=0 → bottom, t=1 → top (SVG y grows downward).
  return geo.plotBottom - t * geo.plotHeight;
}

/**
 * Project an x index into a viewBox x-coordinate. With a single point (count 1)
 * it is centred horizontally; otherwise indices spread evenly from plotLeft to
 * plotRight.
 */
export function projectX(index: number, count: number, geo: ChartGeometry): number {
  if (count <= 1) return geo.plotLeft + geo.plotWidth / 2;
  const t = index / (count - 1);
  return geo.plotLeft + t * geo.plotWidth;
}

/** Project a full series of {x,y} points into viewBox space. */
export function projectPoints(
  points: readonly ChartPoint[],
  domain: YDomain,
  geo: ChartGeometry,
): ProjectedPoint[] {
  const count = points.length;
  return points.map((p) => ({
    cx: projectX(p.x, count, geo),
    cy: projectY(p.y, domain, geo),
  }));
}

/**
 * Evenly spaced y-axis tick values across a domain (inclusive of both ends).
 * `count` is the number of gridlines (>= 2 to include both edges; a count of 1
 * or 0 yields just the domain endpoints deduped).
 */
export function yTicks(domain: YDomain, count = 4): number[] {
  const range = domain.max - domain.min;
  if (count <= 1 || range <= 0) {
    return domain.max === domain.min ? [domain.min] : [domain.min, domain.max];
  }
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) {
    ticks.push(domain.min + (range * i) / (count - 1));
  }
  return ticks;
}

/**
 * Build the `points` attribute string for an SVG <polyline>/<polygon> from
 * projected points, e.g. "12,40 60,30 108,52".
 */
export function polylinePoints(points: readonly ProjectedPoint[]): string {
  return points.map((p) => `${round(p.cx)},${round(p.cy)}`).join(' ');
}

/**
 * Build an SVG path `d` for a STEP-AFTER line (value holds until the next x,
 * then jumps) from projected points. Used by the TM-per-cycle step chart.
 * Returns '' for an empty series.
 */
export function stepAfterPath(points: readonly ProjectedPoint[]): string {
  if (points.length === 0) return '';
  const first = points[0]!;
  let d = `M ${round(first.cx)} ${round(first.cy)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    // Horizontal to the new x at the previous y, then vertical to the new y.
    d += ` L ${round(cur.cx)} ${round(prev.cy)} L ${round(cur.cx)} ${round(cur.cy)}`;
  }
  return d;
}

/** Round to 2 dp to keep SVG attribute strings compact and stable. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
