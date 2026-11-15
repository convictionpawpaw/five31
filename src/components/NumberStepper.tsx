import { useCallback, useEffect, useRef } from 'react';
import { displayDecimals, formatStepperValue } from './stepperFormat.ts';
import './NumberStepper.css';

export interface NumberStepperProps {
  value: number;
  onChange: (next: number) => void;
  step?: number;
  min?: number;
  max?: number;
  /**
   * Minimum decimal places to allow (e.g. 1 for 0.5 kg bodyweight). The display
   * always uses enough places for the step AND the current value (up to 2), so
   * this can never hide a committed fraction.
   */
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
 *
 * Auto-repeat safety: the repeat is stopped by pointerup/leave/cancel on the
 * button AND by any of the following, because a button that disables itself
 * under the finger (at min/max) may never receive its own pointerup:
 *  - the bump that reaches min or max;
 *  - the control becoming disabled or reaching a bound by any route;
 *  - pointerup / pointercancel anywhere in the window, window blur, or the page
 *    becoming hidden;
 *  - `value` changing to something this hold did not emit (the stepper was
 *    repointed at another item — callers that reuse one stepper for several
 *    items should ALSO give it a `key` per item, which remounts it);
 *  - unmount.
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
  /** Values emitted by the CURRENT hold; anything else arriving means repointed. */
  const emitted = useRef<Set<number>>(new Set());
  const detachGlobal = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    if (delayTimer.current !== null) {
      clearTimeout(delayTimer.current);
      delayTimer.current = null;
    }
    if (repeatTimer.current !== null) {
      clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
    if (detachGlobal.current !== null) {
      detachGlobal.current();
      detachGlobal.current = null;
    }
  }, []);

  // Clean up timers and global listeners on unmount.
  useEffect(() => stop, [stop]);

  const atMin = value <= min;
  const atMax = value >= max;

  // Disabled, or at a bound by any route (including a parent clamping): stop.
  useEffect(() => {
    if (disabled || atMin || atMax) stop();
  }, [disabled, atMin, atMax, stop]);

  // A value this hold did not produce means the stepper now points at a
  // different item (or something else rewrote it): never keep counting.
  useEffect(() => {
    if (!emitted.current.has(value)) stop();
  }, [value, stop]);

  const bump = useCallback(
    (dir: 1 | -1) => {
      const next = clamp(normalize(valueRef.current + dir * step), min, max);
      if (next !== valueRef.current) {
        emitted.current.add(next);
        onChange(next);
      }
      // Reaching (or already sitting on) the bound ends any repeat right here,
      // before the button disables itself under the finger.
      if (next <= min || next >= max) stop();
    },
    [max, min, onChange, step, stop],
  );

  const startHold = useCallback(
    (dir: 1 | -1) => {
      if (disabled) return;
      stop();
      emitted.current = new Set([valueRef.current]);
      const next = clamp(normalize(valueRef.current + dir * step), min, max);
      bump(dir);
      // The single tap landed on (or was clamped to) a bound: nothing to repeat.
      if (next <= min || next >= max) return;

      const onGlobalEnd = () => stop();
      const onVisibility = () => {
        if (document.visibilityState !== 'visible') stop();
      };
      window.addEventListener('pointerup', onGlobalEnd);
      window.addEventListener('pointercancel', onGlobalEnd);
      window.addEventListener('blur', onGlobalEnd);
      document.addEventListener('visibilitychange', onVisibility);
      detachGlobal.current = () => {
        window.removeEventListener('pointerup', onGlobalEnd);
        window.removeEventListener('pointercancel', onGlobalEnd);
        window.removeEventListener('blur', onGlobalEnd);
        document.removeEventListener('visibilitychange', onVisibility);
      };

      delayTimer.current = setTimeout(() => {
        delayTimer.current = null;
        repeatTimer.current = setInterval(() => bump(dir), REPEAT_INTERVAL_MS);
      }, REPEAT_DELAY_MS);
    },
    [bump, disabled, max, min, step, stop],
  );

  // The number under the buttons is the number that will be committed: enough
  // places for the step and the value, trailing padding trimmed (a whole 285
  // reads '285', never '285.0'; 102.5 on a step-5 stepper reads '102.5').
  const dp = displayDecimals(value, step, decimals);
  const display = formatStepperValue(value, dp);

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
