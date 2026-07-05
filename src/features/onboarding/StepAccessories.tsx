import type { LiftId } from '../../core/types.ts';
import { Button, HudPanel, NumberStepper } from '../../components/index.ts';
import { DecimalField } from './controls.tsx';
import {
  LIFTS,
  LIFT_LABELS,
  newAccessoryDraft,
  type AccessoryDraft,
  type OnboardingState,
} from './onboardingState.ts';

const MAX_PER_DAY = 3;

export function StepAccessories({
  state,
  setState,
}: {
  state: OnboardingState;
  setState: (updater: (s: OnboardingState) => OnboardingState) => void;
}) {
  const units = state.units.toUpperCase();

  /** Update the accessory at absolute index `idx`. */
  const patchAt = (idx: number, patch: Partial<AccessoryDraft>) =>
    setState((s) => ({
      ...s,
      accessories: s.accessories.map((a, i) => (i === idx ? { ...a, ...patch } : a)),
    }));

  const removeAt = (idx: number) =>
    setState((s) => ({ ...s, accessories: s.accessories.filter((_, i) => i !== idx) }));

  const addForDay = (day: LiftId) =>
    setState((s) => ({ ...s, accessories: [...s.accessories, newAccessoryDraft(day, s.units)] }));

  return (
    <div className="stack step-body">
      <p className="hint label step-intro">
        Optional &mdash; up to {MAX_PER_DAY} accessories per training day. Skip if you like.
      </p>

      {LIFTS.map((day) => {
        // Indices into the flat accessories array for this day (preserve order).
        const dayIndices = state.accessories
          .map((a, i) => ({ a, i }))
          .filter(({ a }) => a.liftDayId === day);
        const atCap = dayIndices.length >= MAX_PER_DAY;

        return (
          <HudPanel key={day} title={`${LIFT_LABELS[day]} Day`}>
            {dayIndices.length === 0 && <p className="hint label">No accessories.</p>}

            {dayIndices.map(({ a, i }) => (
              <div key={i} className="acc-row stack">
                <label className="field">
                  <span className="field__label label">Name</span>
                  <span className="field__box">
                    <input
                      className="field__input acc-name"
                      type="text"
                      value={a.name}
                      placeholder="e.g. Chin-ups"
                      onChange={(e) => patchAt(i, { name: e.target.value })}
                    />
                  </span>
                </label>

                <div className="acc-grid">
                  <div className="acc-cell">
                    <span className="label">Sets</span>
                    <NumberStepper
                      label="Sets"
                      value={a.sets}
                      min={1}
                      max={10}
                      step={1}
                      onChange={(v) => patchAt(i, { sets: v })}
                    />
                  </div>
                  <div className="acc-cell">
                    <span className="label">Rep Min</span>
                    <NumberStepper
                      label="Rep range minimum"
                      value={a.repRangeMin}
                      min={1}
                      max={50}
                      step={1}
                      onChange={(v) => patchAt(i, { repRangeMin: v })}
                    />
                  </div>
                  <div className="acc-cell">
                    <span className="label">Rep Max</span>
                    <NumberStepper
                      label="Rep range maximum"
                      value={a.repRangeMax}
                      min={1}
                      max={50}
                      step={1}
                      onChange={(v) => patchAt(i, { repRangeMax: v })}
                    />
                  </div>
                </div>

                {a.repRangeMin >= a.repRangeMax && a.name.trim().length > 0 && (
                  <p className="error label">Rep min must be below rep max.</p>
                )}

                <div className="acc-grid">
                  <DecimalField
                    label="Start Weight"
                    value={a.currentWeight}
                    suffix={units}
                    onChange={(v) => patchAt(i, { currentWeight: v })}
                  />
                  <DecimalField
                    label="Increment"
                    value={a.increment}
                    suffix={units}
                    onChange={(v) => patchAt(i, { increment: v })}
                  />
                </div>

                <Button variant="danger" onClick={() => removeAt(i)}>
                  Remove
                </Button>
              </div>
            ))}

            {!atCap && (
              <Button variant="ghost" block onClick={() => addForDay(day)}>
                + Add accessory
              </Button>
            )}
          </HudPanel>
        );
      })}
    </div>
  );
}
