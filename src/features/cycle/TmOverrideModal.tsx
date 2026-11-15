import { useState } from 'react';
import type { LiftId, Units } from '../../core/types.ts';
import { applyTmOverride } from '../../db/repo/index.ts';
import { Button, Modal, NumberStepper, useToast } from '../../components/index.ts';
import { LIFT_NAMES } from '../shared/liftLabels.ts';
import { isValidTm, TM_REQUIRED_COPY } from './tmValidation.ts';

/**
 * Mid-cycle TM override for a single lift. Seeds the stepper with the current TM,
 * warns that only PENDING workouts are regenerated, and commits via
 * tmOverrideRepo.applyTmOverride.
 */
export function TmOverrideModal({
  liftId,
  currentTm,
  units,
  step,
  onClose,
}: {
  liftId: LiftId;
  currentTm: number;
  units: Units;
  step: number;
  onClose: () => void;
}) {
  const toast = useToast();
  const [tm, setTm] = useState(currentTm);
  const [busy, setBusy] = useState(false);
  const valid = isValidTm(tm);

  const confirm = async () => {
    if (busy || !valid) return;
    setBusy(true);
    try {
      await applyTmOverride(liftId, tm);
      toast.show(`${LIFT_NAMES[liftId]} TM updated`, 'success');
      onClose();
    } catch (err) {
      setBusy(false);
      toast.show(err instanceof Error ? err.message : 'Override failed', 'danger');
    }
  };

  return (
    <Modal open onClose={onClose} title={`${LIFT_NAMES[liftId]} — override TM`}>
      <div className="tmmodal">
        <NumberStepper
          value={tm}
          onChange={setTm}
          step={step}
          min={step}
          suffix={units.toUpperCase()}
          label="Training max"
        />
        {!valid && <p className="label text-danger tmmodal__warn">{TM_REQUIRED_COPY}</p>}
        <p className="label text-mid tmmodal__warn">
          Regenerates this lift&apos;s pending workouts only — completed work is never rewritten.
        </p>
        <div className="tmmodal__actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" block onClick={confirm} disabled={busy || !valid}>
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
}
