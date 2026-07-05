import { HudPanel } from '../../components/index.ts';
import { SegmentedControl } from './controls.tsx';
import type { OnboardingState } from './onboardingState.ts';

export function StepDeload({
  state,
  setState,
}: {
  state: OnboardingState;
  setState: (updater: (s: OnboardingState) => OnboardingState) => void;
}) {
  return (
    <div className="stack step-body">
      <HudPanel title="Deload Week">
        <SegmentedControl<string>
          ariaLabel="Include deload week"
          value={state.includeDeload ? 'yes' : 'no'}
          onChange={(v) => setState((s) => ({ ...s, includeDeload: v === 'yes' }))}
          options={[
            { value: 'yes', label: 'INCLUDE' },
            { value: 'no', label: 'SKIP' },
          ]}
        />
        <p className="hint label">
          A 4th light week (40 / 50 / 60% &times; 5) after weeks 1&ndash;3. You can change
          this per cycle later.
        </p>
      </HudPanel>
    </div>
  );
}
