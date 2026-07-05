import type { LiftId } from '../../core/types.ts';
import { HudPanel } from '../../components/index.ts';
import { DecimalField, SegmentedControl } from './controls.tsx';
import {
  LIFTS,
  LIFT_LABELS,
  resolveTm,
  type OnboardingState,
  type TmMode,
} from './onboardingState.ts';

export function StepTrainingMaxes({
  state,
  setState,
}: {
  state: OnboardingState;
  setState: (updater: (s: OnboardingState) => OnboardingState) => void;
}) {
  const units = state.units.toUpperCase();

  const patchEntry = (lift: LiftId, patch: Partial<OnboardingState['tmEntries'][LiftId]>) =>
    setState((s) => ({
      ...s,
      tmEntries: { ...s.tmEntries, [lift]: { ...s.tmEntries[lift], ...patch } },
    }));

  return (
    <div className="stack step-body">
      <HudPanel title="TM % of 1RM">
        <SegmentedControl<string>
          ariaLabel="Training max percent"
          value={String(state.tmPercent)}
          onChange={(v) => setState((s) => ({ ...s, tmPercent: Number(v) }))}
          options={[
            { value: '0.85', label: '85%' },
            { value: '0.9', label: '90%' },
          ]}
        />
        <p className="hint label">Applied to any lift entered from a 1-rep max.</p>
      </HudPanel>

      {LIFTS.map((lift) => {
        const entry = state.tmEntries[lift];
        const tm = resolveTm(entry, state.tmPercent, state.roundingIncrement);
        return (
          <HudPanel key={lift} title={LIFT_LABELS[lift]} active={tm > 0}>
            <SegmentedControl<TmMode>
              ariaLabel={`${LIFT_LABELS[lift]} entry mode`}
              value={entry.mode}
              onChange={(mode) => patchEntry(lift, { mode })}
              options={[
                { value: 'oneRm', label: 'FROM 1RM' },
                { value: 'direct', label: 'ENTER TM' },
              ]}
            />

            {entry.mode === 'oneRm' ? (
              <div className="stack tm-oneRm">
                <DecimalField
                  label="Estimated 1RM"
                  value={entry.oneRm}
                  suffix={units}
                  onChange={(oneRm) => patchEntry(lift, { oneRm })}
                />
                <div className="tm-computed row">
                  <span className="label">Training Max</span>
                  <span className="num tm-computed__val text-amber">
                    {tm > 0 ? tm : '—'}
                    <span className="tm-computed__unit label"> {units}</span>
                  </span>
                </div>
              </div>
            ) : (
              <DecimalField
                label="Training Max"
                value={entry.directTm}
                suffix={units}
                onChange={(directTm) => patchEntry(lift, { directTm })}
              />
            )}
          </HudPanel>
        );
      })}
    </div>
  );
}
