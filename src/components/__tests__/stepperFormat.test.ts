import { describe, it, expect } from 'vitest';
import {
  decimalsForStep,
  decimalsForValue,
  displayDecimals,
  formatStepperValue,
} from '../stepperFormat.ts';
import { fmtWeight } from '../../features/shared/format.ts';

/** What the stepper actually renders for a value/step pair. */
function shown(value: number, step: number, decimals?: number): string {
  return formatStepperValue(value, displayDecimals(value, step, decimals));
}

describe('displayDecimals — the display is always the true value', () => {
  it('shows a value finer than the step instead of rounding it', () => {
    expect(shown(102.5, 5)).toBe('102.5'); // was '103'
    expect(shown(107.5, 5)).toBe('107.5'); // one tap from 102.5; was '108'
    expect(shown(61.25, 2.5)).toBe('61.25'); // was '61.3'
    expect(shown(12.5, 5)).toBe('12.5'); // accessory; was '13'
  });

  it('still trims padding for on-step values', () => {
    expect(shown(285, 2.5)).toBe('285');
    expect(shown(100, 5)).toBe('100');
    expect(shown(5, 1)).toBe('5');
    expect(shown(82, 0.5, 1)).toBe('82');
  });

  it('caps the value term at two places, like fmtWeight', () => {
    expect(decimalsForValue(61.234)).toBe(2);
    expect(shown(61.234, 1.25)).toBe('61.23');
  });

  it('agrees with fmtWeight across stepped kg/lb values', () => {
    for (const step of [1.25, 2.5, 5]) {
      for (let v = 0; v <= 300; v = Math.round((v + step / 2) * 1000) / 1000) {
        expect(shown(v, step)).toBe(fmtWeight(v));
      }
    }
  });
});

describe('decimalsForStep', () => {
  it('gives a fractional step exactly the places it needs, capped at 3', () => {
    expect(decimalsForStep(1)).toBe(0);
    expect(decimalsForStep(5)).toBe(0);
    expect(decimalsForStep(2.5)).toBe(1);
    expect(decimalsForStep(1.25)).toBe(2);
  });
});

describe('formatStepperValue — the display equals the committed value', () => {
  it("drops the '.0' a fractional step used to force onto a whole number", () => {
    // The regression: decimalsForStep(2.5) === 1, so every whole lb weight in
    // the new 5x5 dialogs rendered '125.0' / '285.0' directly beneath a
    // fmtWeight'd '125' / '285' for the SAME number.
    expect(formatStepperValue(125, 1)).toBe('125');
    expect(formatStepperValue(285, 1)).toBe('285');
    expect(formatStepperValue(5, 1)).toBe('5');
    expect(formatStepperValue(10, 1)).toBe('10');
  });

  it('never rounds a committed fraction away', () => {
    expect(formatStepperValue(92.5, 1)).toBe('92.5');
    expect(formatStepperValue(122.5, 1)).toBe('122.5');
    // kg 1.25-step values keep both places.
    expect(formatStepperValue(61.25, 2)).toBe('61.25');
    expect(formatStepperValue(1.25, 2)).toBe('1.25');
  });

  it('trims only the PADDING zeros, so a 1.25-step whole/half still reads clean', () => {
    expect(formatStepperValue(92.5, 2)).toBe('92.5'); // not '92.50'
    expect(formatStepperValue(60, 2)).toBe('60'); // not '60.00'
  });

  it('leaves an integer-step stepper (reps, sets) exactly as it was', () => {
    expect(formatStepperValue(5, 0)).toBe('5');
    expect(formatStepperValue(0, 0)).toBe('0');
    expect(formatStepperValue(0, 1)).toBe('0');
  });

  it('honours dp as a CEILING: a value finer than the step still rounds to it', () => {
    expect(formatStepperValue(92.54, 1)).toBe('92.5');
    expect(formatStepperValue(124.96, 1)).toBe('125');
  });
});
