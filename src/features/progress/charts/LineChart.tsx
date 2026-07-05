import { useMemo } from 'react';
import {
  polylinePoints,
  yTicks,
  type ChartPoint,
} from './chartScale.ts';
import { useChartScale } from './useChartScale.ts';
import './charts.css';

/** One point of a line series, with optional PR flag and an x-axis label. */
export interface LinePoint extends ChartPoint {
  /** Render this point as a glowing PR diamond instead of a plain dot. */
  isPr?: boolean;
  /** Optional date label; only the first and last non-empty labels are drawn. */
  label?: string;
}

export interface LineChartProps {
  points: readonly LinePoint[];
  /** Accessible title for the chart region. */
  ariaLabel: string;
  /** Show the faint amber area fill under the line. Default: true. */
  area?: boolean;
  /** Number of horizontal gridlines. Default: 4. */
  gridlines?: number;
  /** Format a y value for the axis labels. Default: rounded integer. */
  formatY?: (value: number) => string;
}

const VB_W = 300;
const VB_H = 160;

/**
 * Hand-rolled SVG line chart. Amber series with cyan gridlines, PR points drawn
 * as glowing amber diamonds. Renders sanely with 1 point (centred dot) or 50+
 * (evenly spread). Width-responsive via viewBox — never a fixed pixel width, so
 * it can't overflow a 375px screen.
 */
export function LineChart({
  points,
  ariaLabel,
  area = true,
  gridlines = 4,
  formatY = (v) => String(Math.round(v)),
}: LineChartProps) {
  const { geo, domain, projected } = useChartScale(points, VB_W, VB_H);

  const linePts = useMemo(() => polylinePoints(projected), [projected]);
  const ticks = useMemo(() => yTicks(domain, gridlines), [domain, gridlines]);

  // Area polygon: the line, then down to the baseline and back.
  const areaPts = useMemo(() => {
    if (projected.length === 0) return '';
    const base = geo.plotBottom;
    const first = projected[0]!;
    const last = projected[projected.length - 1]!;
    return `${polylinePoints(projected)} ${round(last.cx)},${round(base)} ${round(first.cx)},${round(base)}`;
  }, [projected, geo.plotBottom]);

  const firstLabel = points.find((p) => p.label)?.label;
  const lastLabel = [...points].reverse().find((p) => p.label)?.label;

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={ariaLabel}
    >
      {/* Gridlines + y labels */}
      {ticks.map((t, i) => {
        const y = projectYLocal(t, domain, geo.plotTop, geo.plotBottom);
        return (
          <g key={i}>
            <line className="chart__grid" x1={geo.plotLeft} y1={y} x2={geo.plotRight} y2={y} />
            <text className="chart__ylabel" x={geo.plotLeft} y={y - 2}>
              {formatY(t)}
            </text>
          </g>
        );
      })}

      {/* Baseline axis */}
      <line
        className="chart__axis"
        x1={geo.plotLeft}
        y1={geo.plotBottom}
        x2={geo.plotRight}
        y2={geo.plotBottom}
      />

      {/* Area + series */}
      {area && projected.length > 1 && <polygon className="chart__area" points={areaPts} />}
      {projected.length > 1 && <polyline className="chart__series" points={linePts} />}

      {/* Points: PR diamonds vs plain dots */}
      {projected.map((p, i) => {
        const pr = points[i]?.isPr ?? false;
        if (pr) {
          const s = 3.2;
          const d = `${round(p.cx)},${round(p.cy - s)} ${round(p.cx + s)},${round(p.cy)} ${round(p.cx)},${round(p.cy + s)} ${round(p.cx - s)},${round(p.cy)}`;
          return <polygon key={i} className="chart__pr" points={d} />;
        }
        return <circle key={i} className="chart__dot" cx={p.cx} cy={p.cy} r={projected.length > 30 ? 1.1 : 1.8} />;
      })}

      {/* x-axis date labels (first / last) */}
      {firstLabel && (
        <text className="chart__xlabel chart__xlabel--start" x={geo.plotLeft} y={geo.height - 2}>
          {firstLabel}
        </text>
      )}
      {lastLabel && lastLabel !== firstLabel && (
        <text className="chart__xlabel chart__xlabel--end" x={geo.plotRight} y={geo.height - 2}>
          {lastLabel}
        </text>
      )}
    </svg>
  );
}

/** Local y-projection mirroring chartScale.projectY without importing geometry twice. */
function projectYLocal(
  value: number,
  domain: { min: number; max: number },
  top: number,
  bottom: number,
): number {
  const range = domain.max - domain.min;
  if (range <= 0) return (top + bottom) / 2;
  const t = (value - domain.min) / range;
  return bottom - t * (bottom - top);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
