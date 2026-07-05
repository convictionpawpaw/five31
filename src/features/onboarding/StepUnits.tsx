import type { Units } from '../../core/types.ts';
import { roundingIncrementOptions } from '../../core/units.ts';
import { HudPanel } from '../../components/index.ts';
import { SegmentedControl } from './controls.tsx';
import { applyUnitChange, type OnboardingState } from './onboardingState.ts';

export function StepUnits({
  state,
  setState,
}: {
  state: OnboardingState;
  setState: (updater: (s: OnboardingState) => OnboardingState) => void;
}) {
  const roundingOptions = roundingIncrementOptions(state.units);

  return (
    <div className="stack step-body">
      <HudPanel title="Units">
        <SegmentedControl<Units>
          ariaLabel="Weight units"
          value={state.units}
          onChange={(u) => setState((s) => applyUnitChange(s, u))}
          options={[
            { value: 'lb', label: 'LB' },
            { value: 'kg', label: 'KG' },
          ]}
        />
        <p className="hint label">Barbell plate units for every weight.</p>
      </HudPanel>

      <HudPanel title="Rounding Increment">
        <SegmentedControl<string>
          ariaLabel="Rounding increment"
          value={String(state.roundingIncrement)}
          onChange={(v) => setState((s) => ({ ...s, roundingIncrement: Number(v) }))}
          options={roundingOptions.map((inc) => ({
            value: String(inc),
            label: `${inc} ${state.units.toUpperCase()}`,
          }))}
        />
        <p className="hint label">Set weights snap to the nearest of these.</p>
      </HudPanel>
    </div>
  );
}
