import { useMemo } from 'react';
import { stepAfterPath, yTicks, type ChartPoint } from './chartScale.ts';
import { useChartScale } from './useChartScale.ts';
import './charts.css';

/** One step: an x index (cycle number position) with a y value (TM). */
export interface StepPoint extends ChartPoint {
  /** Optional label drawn under the first/last step. */
  label?: string;
}

export interface StepChartProps {
  points: readonly StepPoint[];
  ariaLabel: string;
  gridlines?: number;
  formatY?: (value: number) => string;
}

const VB_W = 300;
const VB_H = 160;

/**
 * Hand-rolled step-after line chart (value holds until the next x, then jumps).
 * Used for Training-Max-per-cycle: a TM is constant through a cycle and steps up
 * at each advance. Amber step line, cyan gridlines. Width-responsive via viewBox.
 */
export function StepChart({
  points,
  ariaLabel,
  gridlines = 4,
  formatY = (v) => String(Math.round(v)),
}: StepChartProps) {
  const { geo, domain, projected } = useChartScale(points, VB_W, VB_H);

  const path = useMemo(() => stepAfterPath(projected), [projected]);
  const ticks = useMemo(() => yTicks(domain, gridlines), [domain, gridlines]);

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

      <line
        className="chart__axis"
        x1={geo.plotLeft}
        y1={geo.plotBottom}
        x2={geo.plotRight}
        y2={geo.plotBottom}
      />

      {projected.length > 1 && <path className="chart__step" d={path} />}

      {projected.map((p, i) => (
        <circle key={i} className="chart__dot" cx={p.cx} cy={p.cy} r={projected.length > 30 ? 1.1 : 1.8} />
      ))}

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
