import { useMemo, useState } from 'react';
import type { LiftId, Settings, Workout } from '../../core/types.ts';
import { DAY_ORDER } from '../../core/scheme.ts';
import { cycleAdvancePlan, type AdvancePlanEntry } from '../../core/cycle.ts';
import { roundToIncrement } from '../../core/rounding.ts';
import { completeCycle } from '../../db/repo/index.ts';
import { Button, Modal, NumberStepper, useToast } from '../../components/index.ts';
import { cycleTag, LIFT_NAMES, weekLabel } from '../shared/liftLabels.ts';
import { fmtWeight } from '../shared/format.ts';

/** Find the completed AMRAP week that fell short, for the HOLD reason copy. */
function missedWeekLabel(workouts: readonly Workout[], liftId: LiftId): string | null {
  for (const w of workouts) {
    if (w.liftId !== liftId || w.status !== 'completed' || w.week === 4) continue;
    for (const s of w.mainSets) {
      if (s.amrap && s.actualReps !== undefined && s.actualReps < s.targetReps) {
        return weekLabel(w.week);
      }
    }
  }
  return null;
}

export function CompleteCycleModal({
  workouts,
  settings,
  currentTms,
  cycleNumber,
  onClose,
  onDone,
}: {
  workouts: readonly Workout[];
  settings: Settings;
  currentTms: Record<LiftId, number>;
  cycleNumber: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const plan = useMemo(
    () => cycleAdvancePlan(workouts, currentTms, settings.liftIncrements),
    [workouts, currentTms, settings.liftIncrements],
  );

  const [tms, setTms] = useState<Record<LiftId, number>>(() => {
    const init = {} as Record<LiftId, number>;
    for (const entry of plan) init[entry.liftId] = entry.recommendedTm;
    return init;
  });
  const [busy, setBusy] = useState(false);

  const step = settings.units === 'kg' ? 1.25 : 2.5;

  const setTm = (liftId: LiftId, value: number) => {
    setTms((prev) => ({ ...prev, [liftId]: value }));
  };

  const resetTo90 = (liftId: LiftId) => {
    const ninety = roundToIncrement(currentTms[liftId] * 0.9, settings.roundingIncrement);
    setTm(liftId, ninety);
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await completeCycle(tms);
      onDone();
      toast.show(`Cycle ${cycleTag(cycleNumber + 1)} initialized`, 'success');
    } catch (err) {
      setBusy(false);
      toast.show(err instanceof Error ? err.message : 'Failed to complete cycle', 'danger');
    }
  };

  const byLift = new Map<LiftId, AdvancePlanEntry>(plan.map((p) => [p.liftId, p]));

  return (
    <Modal open onClose={onClose} title="Complete Cycle">
      <div className="ccmodal">
        {DAY_ORDER.map((liftId) => {
          const entry = byLift.get(liftId)!;
          const hold = entry.recommendation === 'hold';
          const reason = hold ? missedWeekLabel(workouts, liftId) : null;
          return (
            <div key={liftId} className="ccmodal__lift">
              <div className="ccmodal__lift-head">
                <span className="label label-hi">{LIFT_NAMES[liftId]}</span>
                <span className={`ccchip ccchip--${hold ? 'hold' : 'increase'} label`}>
                  {hold ? 'Hold' : 'Increase'}
                </span>
              </div>
              <div className="ccmodal__lift-flow label text-mid">
                <span className="num">{fmtWeight(entry.currentTm)}</span>
                <span className="ccmodal__arrow">→</span>
                <span className="num text-amber">{fmtWeight(entry.recommendedTm)}</span>
                {reason && <span className="text-low">missed AMRAP {reason}</span>}
              </div>
              <div className="ccmodal__lift-edit">
                <NumberStepper
                  value={tms[liftId]}
                  onChange={(v) => setTm(liftId, v)}
                  step={step}
                  min={0}
                  decimals={settings.units === 'kg' ? 1 : 0}
                  suffix={settings.units.toUpperCase()}
                  label={`${LIFT_NAMES[liftId]} new TM`}
                />
                <Button variant="ghost" onClick={() => resetTo90(liftId)}>
                  Reset to 90%
                </Button>
              </div>
            </div>
          );
        })}

        <div className="ccmodal__actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" block onClick={confirm} disabled={busy}>
            Confirm
          </Button>
        </div>
      </div>
    </Modal>
  );
}
