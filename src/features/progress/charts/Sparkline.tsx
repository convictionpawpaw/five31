import { computeYDomain, chartGeometry, projectPoints, polylinePoints } from './chartScale.ts';

export interface SparklineProps {
  /** Raw y values in chronological order (e.g. last-6 session weights). */
  values: readonly number[];
  ariaLabel: string;
}

const VB_W = 100;
const VB_H = 28;
const MARGIN = 3;

/**
 * Tiny inline amber sparkline for accessory cards — a mini line with an end dot.
 * No axes/labels; width-responsive via viewBox. Renders nothing for < 2 values.
 */
export function Sparkline({ values, ariaLabel }: SparklineProps) {
  if (values.length < 2) return null;

  const geo = chartGeometry(VB_W, VB_H, MARGIN);
  const domain = computeYDomain(values);
  const projected = projectPoints(
    values.map((y, x) => ({ x, y })),
    domain,
    geo,
  );
  const last = projected[projected.length - 1]!;

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <polyline
        points={polylinePoints(projected)}
        fill="none"
        stroke="var(--amber)"
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last.cx} cy={last.cy} r={2} fill="var(--amber-hi)" />
    </svg>
  );
}
