import { useState } from 'react';
import type { SlLiftId, SlLiftRuntime, Units, Workout } from '../../core/types.ts';
import {
  SL_OVERRIDE_IN_FLIGHT_ERROR,
  overrideSlLiftWeight,
  slOverrideBlockedByInFlight,
} from '../../db/repo/index.ts';
import { Button, Modal, NumberStepper, useToast } from '../../components/index.ts';
import { LIFT_NAMES } from '../shared/liftLabels.ts';
import { fmtWeight } from '../shared/format.ts';
import { slStreakPips } from './slView.ts';

/**
 * Working-weight override for a single StrongLifts lift — the block's analogue
 * of {@link TmOverrideModal}. Seeds the stepper with the lift's current working
 * weight, states plainly that only FUTURE sessions move and that the miss streak
 * survives, and commits through slRepo.overrideSlLiftWeight.
 *
 * When the session in flight trains THIS lift the override is refused by the
 * repo, so the modal reads the same predicate off the live rows and says so up
 * front: the control is disabled with the reason under it, rather than letting
 * the user set a number and take a rejection toast for it.
 */
export function SlWeightOverrideModal({
  cycleId,
  liftId,
  runtime,
  units,
  step,
  workouts,
  onClose,
}: {
  cycleId: string;
  liftId: SlLiftId;
  runtime: SlLiftRuntime;
  units: Units;
  step: number;
  /** The block's live rows — the in-flight guard is read from these. */
  workouts: readonly Workout[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [weight, setWeight] = useState(runtime.weight);
  const [busy, setBusy] = useState(false);
  const blocked = slOverrideBlockedByInFlight(workouts, liftId);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await overrideSlLiftWeight(cycleId, liftId, weight);
      toast.show(`${LIFT_NAMES[liftId]} set to ${fmtWeight(weight)} ${units.toUpperCase()}`, 'success');
      onClose();
    } catch (err) {
      setBusy(false);
      toast.show(err instanceof Error ? err.message : 'Override failed', 'danger');
    }
  };

  const pips = slStreakPips(runtime.failStreak);

  return (
    <Modal open onClose={onClose} title={`${LIFT_NAMES[liftId]} — working weight`}>
      <div className="tmmodal">
        <NumberStepper
          value={weight}
          onChange={setWeight}
          step={step}
          min={0}
          suffix={units.toUpperCase()}
          label={`${LIFT_NAMES[liftId]} working weight`}
          disabled={blocked}
        />

        <div className="slcell__pips" aria-label={`${runtime.failStreak} of 3 misses`}>
          {pips.map((on, i) => (
            <span key={i} className={`slpip${on ? ' is-on' : ''}`} aria-hidden="true" />
          ))}
          <span className="label text-low">
            &nbsp;miss {runtime.failStreak} of 3 · +{fmtWeight(runtime.increment)} per pass
          </span>
        </div>

        {blocked ? (
          <p className="label text-danger tmmodal__warn">{SL_OVERRIDE_IN_FLIGHT_ERROR}</p>
        ) : (
          <p className="label text-mid tmmodal__warn">
            Applies from the next session onward — a session already started keeps the weight it
            opened at. The miss streak is preserved, so a deload you have already earned still
            lands.
          </p>
        )}
        <div className="tmmodal__actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {blocked ? 'Close' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            block
            onClick={confirm}
            disabled={busy || blocked || weight <= 0}
          >
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
}
