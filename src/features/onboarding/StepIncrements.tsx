import { HudPanel, NumberStepper } from '../../components/index.ts';
import { LIFTS, LIFT_LABELS, type OnboardingState } from './onboardingState.ts';

export function StepIncrements({
  state,
  setState,
}: {
  state: OnboardingState;
  setState: (updater: (s: OnboardingState) => OnboardingState) => void;
}) {
  const units = state.units.toUpperCase();
  // Stepper granularity: lb steps by 5, kg by 2.5.
  const step = state.units === 'lb' ? 5 : 2.5;

  return (
    <div className="stack step-body">
      <p className="hint label step-intro">
        How much each lift&rsquo;s Training Max climbs when you complete a cycle.
      </p>
      {LIFTS.map((lift) => (
        <HudPanel key={lift} title={LIFT_LABELS[lift]}>
          <NumberStepper
            label={`${LIFT_LABELS[lift]} increment`}
            value={state.liftIncrements[lift]}
            min={step}
            step={step}
            suffix={units}
            onChange={(v) =>
              setState((s) => ({
                ...s,
                liftIncrements: { ...s.liftIncrements, [lift]: v },
              }))
            }
          />
        </HudPanel>
      ))}
    </div>
  );
}
