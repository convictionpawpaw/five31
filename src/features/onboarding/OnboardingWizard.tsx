import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { OnboardingPayload } from '../../db/repo/onboardingRepo.ts';
import { initializeFromOnboarding } from '../../db/repo/index.ts';
import { Button, useToast } from '../../components/index.ts';
import {
  initialOnboardingState,
  resolveAllTms,
  toAccessoryInputs,
  type OnboardingState,
} from './onboardingState.ts';
import { isStepValid } from './validation.ts';
import { StepUnits } from './StepUnits.tsx';
import { StepTrainingMaxes } from './StepTrainingMaxes.tsx';
import { StepIncrements } from './StepIncrements.tsx';
import { StepDeload } from './StepDeload.tsx';
import { StepAccessories } from './StepAccessories.tsx';
import { StepReview } from './StepReview.tsx';
import './onboarding.css';

const STEP_TITLES = ['Units', 'Training Maxes', 'Increments', 'Deload', 'Accessories', 'Review'];
const LAST_STEP = STEP_TITLES.length - 1;

/**
 * Build the exact OnboardingPayload contract from wizard state. No casts: every
 * field is constructed from resolved, typed values.
 */
function buildPayload(state: OnboardingState): OnboardingPayload {
  return {
    units: state.units,
    roundingIncrement: state.roundingIncrement,
    tmPercent: state.tmPercent,
    includeDeload: state.includeDeload,
    liftIncrements: state.liftIncrements,
    trainingMaxes: resolveAllTms(state),
    accessories: toAccessoryInputs(state.accessories),
  };
}

export function OnboardingWizard() {
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<OnboardingState>(() => initialOnboardingState('lb'));
  const [submitting, setSubmitting] = useState(false);

  const canAdvance = isStepValid(step, state);

  const goNext = () => {
    if (!canAdvance) return;
    setStep((s) => Math.min(LAST_STEP, s + 1));
  };
  const goBack = () => setStep((s) => Math.max(0, s - 1));

  const submit = async () => {
    if (submitting || !isStepValid(LAST_STEP, state)) return;
    setSubmitting(true);
    try {
      await initializeFromOnboarding(buildPayload(state));
      navigate('/', { replace: true });
    } catch (err) {
      setSubmitting(false);
      const msg = err instanceof Error ? err.message : 'Failed to initialize.';
      toast.show(msg, 'danger');
    }
  };

  return (
    <div className="onboarding safe-x safe-top">
      <header className="onboarding__head">
        <h1 className="onboarding__brand num">FIVE31</h1>
        <p className="onboarding__sub label">Initialize &mdash; Cycle 01</p>

        <div className="ticks" role="progressbar" aria-valuemin={1} aria-valuemax={STEP_TITLES.length} aria-valuenow={step + 1}>
          {STEP_TITLES.map((title, i) => (
            <span
              key={title}
              className={`tick${i === step ? ' is-current' : ''}${i < step ? ' is-done' : ''}`}
            />
          ))}
        </div>
        <p className="onboarding__step-name label label-hi">
          {step + 1} / {STEP_TITLES.length} &middot; {STEP_TITLES[step]}
        </p>
      </header>

      <main className="onboarding__body">
        {step === 0 && <StepUnits state={state} setState={setState} />}
        {step === 1 && <StepTrainingMaxes state={state} setState={setState} />}
        {step === 2 && <StepIncrements state={state} setState={setState} />}
        {step === 3 && <StepDeload state={state} setState={setState} />}
        {step === 4 && <StepAccessories state={state} setState={setState} />}
        {step === 5 && <StepReview state={state} />}
      </main>

      <footer className="onboarding__nav safe-bottom">
        {step > 0 && (
          <Button variant="ghost" onClick={goBack} disabled={submitting}>
            Back
          </Button>
        )}
        {step < LAST_STEP ? (
          <Button variant="primary" block onClick={goNext} disabled={!canAdvance}>
            Next
          </Button>
        ) : (
          <Button variant="primary" block onClick={submit} disabled={!canAdvance || submitting}>
            {submitting ? 'Initializing…' : 'Initialize Cycle 01'}
          </Button>
        )}
      </footer>
    </div>
  );
}
