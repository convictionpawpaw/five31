import { useCallback, useEffect, useRef } from 'react';
import { decimalsForStep, formatStepperValue } from './stepperFormat.ts';
import './NumberStepper.css';

export interface NumberStepperProps {
  value: number;
  onChange: (next: number) => void;
  step?: number;
  min?: number;
  max?: number;
  /** Decimal places to display (e.g. 1 for 2.5 kg increments). Default: auto. */
  decimals?: number;
  /** Uppercase unit/suffix shown after the number, e.g. 'LB'. */
  suffix?: string;
  /** Accessible label for the whole control. */
  label?: string;
  disabled?: boolean;
}

const REPEAT_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 90;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Round away binary float noise from repeated ± of fractional steps. */
function normalize(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Big +/- stepper with press-and-hold auto-repeat. Finger-friendly (≥48px
 * buttons), clamps to min/max, and shows the value as a large Rajdhani numeral.
 */
export function NumberStepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  decimals,
  suffix,
  label,
  disabled = false,
}: NumberStepperProps) {
  // Keep the latest value in a ref so the repeat timer always reads fresh state.
  const valueRef = useRef(value);
  valueRef.current = value;

  const delayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (delayTimer.current !== null) {
      clearTimeout(delayTimer.current);
      delayTimer.current = null;
    }
    if (repeatTimer.current !== null) {
      clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
  }, []);

  // Clean up timers on unmount.
  useEffect(() => stop, [stop]);

  const bump = useCallback(
    (dir: 1 | -1) => {
      const next = clamp(normalize(valueRef.current + dir * step), min, max);
      if (next !== valueRef.current) onChange(next);
    },
    [max, min, onChange, step],
  );

  const startHold = useCallback(
    (dir: 1 | -1) => {
      if (disabled) return;
      bump(dir);
      stop();
      delayTimer.current = setTimeout(() => {
        repeatTimer.current = setInterval(() => bump(dir), REPEAT_INTERVAL_MS);
      }, REPEAT_DELAY_MS);
    },
    [bump, disabled, stop],
  );

  // `dp` is the precision CEILING; formatStepperValue trims the padding so the
  // number under the buttons is the number that will be committed — a whole
  // 285 reads '285', never '285.0' beside a fmtWeight'd '285' in the same row.
  const dp = decimals ?? decimalsForStep(step);
  const display = formatStepperValue(value, dp);

  const atMin = value <= min;
  const atMax = value >= max;

  return (
    <div className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="stepper__btn"
        aria-label="Decrease"
        disabled={disabled || atMin}
        onPointerDown={() => startHold(-1)}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
      >
        −
      </button>
      <div className="stepper__value">
        <span className="num stepper__num">{display}</span>
        {suffix !== undefined && <span className="stepper__suffix label">{suffix}</span>}
      </div>
      <button
        type="button"
        className="stepper__btn"
        aria-label="Increase"
        disabled={disabled || atMax}
        onPointerDown={() => startHold(1)}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
      >
        +
      </button>
    </div>
  );
}
