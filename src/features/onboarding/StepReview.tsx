import type { LiftId } from '../../core/types.ts';
import { buildMainSets } from '../../core/setCalc.ts';
import { HudPanel } from '../../components/index.ts';
import {
  LIFTS,
  LIFT_LABELS,
  accessoriesForDay,
  resolveTm,
  type OnboardingState,
} from './onboardingState.ts';

/** The week-1 top (AMRAP) set for a lift, computed exactly as the cycle will. */
function week1TopSet(tm: number, roundingIncrement: number): { weight: number; reps: number } {
  const sets = buildMainSets(tm, 1, roundingIncrement);
  const work = sets.filter((s) => s.kind === 'work');
  const top = work[work.length - 1];
  // Week 1 always yields 3 work sets; top is defined. Fall back defensively.
  return top ? { weight: top.weight, reps: top.targetReps } : { weight: 0, reps: 0 };
}

export function StepReview({ state }: { state: OnboardingState }) {
  const units = state.units.toUpperCase();

  return (
    <div className="stack step-body">
      <HudPanel title="Configuration">
        <dl className="review-list">
          <div className="review-row">
            <dt className="label">Units</dt>
            <dd className="num">{units}</dd>
          </div>
          <div className="review-row">
            <dt className="label">Rounding</dt>
            <dd className="num">
              {state.roundingIncrement} {units}
            </dd>
          </div>
          <div className="review-row">
            <dt className="label">TM %</dt>
            <dd className="num">{Math.round(state.tmPercent * 100)}%</dd>
          </div>
          <div className="review-row">
            <dt className="label">Deload</dt>
            <dd className="num">{state.includeDeload ? 'YES' : 'NO'}</dd>
          </div>
        </dl>
      </HudPanel>

      <HudPanel title="Training Maxes & Week 1 Top Set">
        <div className="review-lifts">
          {LIFTS.map((lift: LiftId) => {
            const tm = resolveTm(state.tmEntries[lift], state.tmPercent, state.roundingIncrement);
            const top = week1TopSet(tm, state.roundingIncrement);
            return (
              <div key={lift} className="review-lift">
                <span className="review-lift__name label label-hi">{LIFT_LABELS[lift]}</span>
                <div className="review-lift__nums">
                  <span className="review-lift__tm">
                    <span className="label">TM</span>{' '}
                    <span className="num text-amber">{tm}</span>
                  </span>
                  <span className="review-lift__top">
                    <span className="label">WK1 TOP</span>{' '}
                    <span className="num text-cyan">
                      {top.weight}&thinsp;&times;&thinsp;{top.reps}+
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </HudPanel>

      <HudPanel title="Increments">
        <dl className="review-list">
          {LIFTS.map((lift) => (
            <div key={lift} className="review-row">
              <dt className="label">{LIFT_LABELS[lift]}</dt>
              <dd className="num">
                +{state.liftIncrements[lift]} {units}
              </dd>
            </div>
          ))}
        </dl>
      </HudPanel>

      <HudPanel title="Accessories">
        {state.accessories.filter((a) => a.name.trim().length > 0).length === 0 ? (
          <p className="hint label">None configured.</p>
        ) : (
          <div className="stack review-acc">
            {LIFTS.map((day) => {
              const rows = accessoriesForDay(state, day).filter((a) => a.name.trim().length > 0);
              if (rows.length === 0) return null;
              return (
                <div key={day} className="review-acc-day">
                  <span className="label label-hi">{LIFT_LABELS[day]}</span>
                  {rows.map((a, i) => (
                    <div key={i} className="review-acc-row">
                      <span className="review-acc-name">{a.name}</span>
                      <span className="num text-mid">
                        {a.sets}&times;{a.repRangeMin}-{a.repRangeMax} @ {a.currentWeight} {units}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </HudPanel>
    </div>
  );
}
