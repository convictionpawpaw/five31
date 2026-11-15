import { useMemo, useState } from 'react';
import type {
  Cycle,
  LiftId,
  SlLiftId,
  Settings,
  Workout,
} from '../../core/types.ts';
import { normalizeDayOrder } from '../../core/scheme.ts';
import { cycleAdvancePlan } from '../../core/cycle.ts';
import { roundToIncrement } from '../../core/rounding.ts';
import {
  SL_LIFTS,
  defaultSlIncrements,
  slReturnTmSuggestions,
  slSwitchInSuggestions,
} from '../../core/sl.ts';
import {
  clearPendingProgramSwitch,
  completeCycle,
  completeCycleToSl,
  completeSlCycleContinue,
  completeSlCycleReturn,
} from '../../db/repo/index.ts';
import { Button, Modal, NumberStepper, useToast } from '../../components/index.ts';
import { cycleTag, LIFT_NAMES, weekLabel } from '../shared/liftLabels.ts';
import { fmtWeight } from '../shared/format.ts';
import {
  SL_ROW_REQUIRED_COPY,
  SL_ROW_START_COPY,
  SL_SWITCH_IN_WEIGHT_COPY,
  SL_WEIGHT_REQUIRED_COPY,
  bestSlEffortsByLift,
  carriedRowChipLabel,
  carriedRowPrefill,
  keepPrsCopy,
  latestSlRowWeight,
  slDeadliftIncrementCopy,
  slReturnBasisCopy,
  slSetupBlockingLifts,
  slStreakPips,
} from '../sl/slView.ts';
import '../sl/sl.css';
import { invalidTmLifts, TM_REQUIRED_COPY } from './tmValidation.ts';

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

export interface CompleteCycleModalProps {
  /** The cycle being completed — its `program` selects the modal's mode. */
  cycle: Cycle;
  /** Every cycle, so a returning block can carry its row weight forward. */
  cycles: readonly Cycle[];
  workouts: readonly Workout[];
  settings: Settings;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Completing a cycle is also the ONE moment the program can change, so this
 * modal is two-mode on the completed cycle's program:
 *
 *  - a 5/3/1 cycle offers [Continue 5/3/1 | Switch to StrongLifts 5×5];
 *  - a StrongLifts block offers [Continue 5×5 | Return to 5/3/1].
 *
 * The segment is PRESELECTED from `settings.pendingProgramSwitch` (armed in
 * Settings), and the arming is consumed on every confirm — including when the
 * user declines it by choosing the other option, which is the only path that
 * has to disarm explicitly (`completeSlCycleContinue` deliberately leaves
 * Settings alone, and `completeCycle` never touches it).
 */
export function CompleteCycleModal(props: CompleteCycleModalProps) {
  const isSl = props.cycle.program === 'sl5x5' && props.cycle.sl !== undefined;
  return isSl ? <SlCompleteModal {...props} /> : <ClassicCompleteModal {...props} />;
}

/** Consume an armed switch the user has just declined (or superseded). */
async function disarmIfArmed(settings: Settings): Promise<void> {
  if (settings.pendingProgramSwitch !== undefined) await clearPendingProgramSwitch();
}

// ---------------------------------------------------------------------------
// Segment control
// ---------------------------------------------------------------------------

function ProgramSegment<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="tablist" aria-label="Next program">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={`segmented__seg${value === o.value ? ' is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function KeepPrsToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div className="ccmodal__keepprs">
      <div className="ccmodal__keepprs-head">
        <span className="label text-mid">Keep PRs</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Keep personal records"
          className={`toggle${on ? ' is-on' : ''}`}
          onClick={onToggle}
        >
          <span className="toggle__knob" aria-hidden="true" />
        </button>
      </div>
      <p className={`ccmodal__copy${on ? '' : ' text-amber'}`}>{keepPrsCopy(on)}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode A — completing a 5/3/1 cycle
// ---------------------------------------------------------------------------

function ClassicCompleteModal({
  cycle,
  cycles,
  workouts,
  settings,
  onClose,
  onDone,
}: CompleteCycleModalProps) {
  const toast = useToast();
  const currentTms = cycle.tms;
  const order = useMemo(() => normalizeDayOrder(settings.dayOrder), [settings.dayOrder]);
  const plan = useMemo(
    () => cycleAdvancePlan(workouts, currentTms, settings.liftIncrements, order),
    [workouts, currentTms, settings.liftIncrements, order],
  );

  const [choice, setChoice] = useState<'five31' | 'sl5x5'>(
    settings.pendingProgramSwitch === 'sl5x5' ? 'sl5x5' : 'five31',
  );
  const [tms, setTms] = useState<Record<LiftId, number>>(() => {
    const init = {} as Record<LiftId, number>;
    for (const entry of plan) init[entry.liftId] = entry.recommendedTm;
    return init;
  });

  // --- StrongLifts setup state ---
  const suggested = useMemo(
    () => slSwitchInSuggestions(currentTms, settings.roundingIncrement),
    [currentTms, settings.roundingIncrement],
  );
  // The carried row weight is denominated in the units of the block it came
  // FROM — a completed block's runtime is frozen in the units it ended in — so
  // it is converted into today's units before it can be prefilled. Handing the
  // raw number over would prefill '165 KG' from a 165 LB block: 2.2× the real
  // weight, wearing a 'carried' chip that says it can be trusted.
  const carriedRow = useMemo(() => latestSlRowWeight(cycles), [cycles]);
  const carriedRowWeight = useMemo(
    () =>
      carriedRow === null
        ? null
        : carriedRowPrefill(carriedRow, settings.units, settings.roundingIncrement),
    [carriedRow, settings.units, settings.roundingIncrement],
  );
  const [slWeights, setSlWeights] = useState<Record<SlLiftId, number>>(() => ({
    squat: suggested.squat,
    bench: suggested.bench,
    row: carriedRowWeight ?? 0, // 0 = not chosen yet; the confirm is gated on it
    press: suggested.press,
    deadlift: suggested.deadlift,
  }));
  const [slIncrements, setSlIncrements] = useState<Record<SlLiftId, number>>(() =>
    defaultSlIncrements(settings.units),
  );
  const [keepPrs, setKeepPrs] = useState(true);
  const [busy, setBusy] = useState(false);

  const tmStep = settings.units === 'kg' ? 1.25 : 2.5;
  const weightStep = settings.roundingIncrement;
  const incStep = settings.units === 'kg' ? 1.25 : 2.5;

  const setTm = (liftId: LiftId, value: number) => setTms((prev) => ({ ...prev, [liftId]: value }));
  const resetTo90 = (liftId: LiftId) =>
    setTm(liftId, roundToIncrement(currentTms[liftId] * 0.9, settings.roundingIncrement));

  // Every one of the five weights gates the confirm, not just the row: the
  // steppers clamp at min 0, so a press-and-hold on any minus button reaches
  // zero, and completeCycleToSl refuses all five alike. The reason shows as copy
  // under the offending stepper — a toast fired after the tap would not say
  // WHICH lift, and would have scrolled past the one that needs the fix.
  const blockingLifts = slSetupBlockingLifts(slWeights);
  const slSetupBlocked = blockingLifts.length > 0;
  // Same rule for the Continue path: a TM must be a finite number above zero.
  const badTmLifts = invalidTmLifts(tms, order);
  const tmsBlocked = badTmLifts.length > 0;

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (choice === 'sl5x5') {
        // Defence in depth; the button is disabled while this holds.
        if (slSetupBlocked) {
          setBusy(false);
          return;
        }
        // completeCycleToSl consumes the armed switch itself, inside its txn.
        await completeCycleToSl({
          weights: slWeights,
          increments: slIncrements,
          keepPrs,
          expectedCycleId: cycle.id,
        });
        onDone();
        toast.show('StrongLifts 5×5 block started', 'success');
        return;
      }
      if (tmsBlocked) {
        setBusy(false);
        return;
      }
      // The user declined an armed switch (or there was none): disarm, then advance.
      await disarmIfArmed(settings);
      await completeCycle(tms, cycle.id);
      onDone();
      toast.show(`Cycle ${cycleTag(cycle.number + 1)} initialized`, 'success');
    } catch (err) {
      setBusy(false);
      toast.show(err instanceof Error ? err.message : 'Failed to complete cycle', 'danger');
    }
  };

  return (
    <Modal open onClose={onClose} title="Complete Cycle">
      <div className="ccmodal">
        <ProgramSegment
          options={[
            { value: 'five31', label: 'Continue 5/3/1' },
            { value: 'sl5x5', label: 'Switch to 5×5' },
          ]}
          value={choice}
          onChange={setChoice}
        />
        {settings.pendingProgramSwitch === 'sl5x5' && (
          <p className="ccmodal__copy text-cyan">
            A switch to StrongLifts 5×5 was armed in Settings. Choosing Continue cancels it.
          </p>
        )}

        {choice === 'five31' ? (
          plan.map((entry) => {
            const liftId = entry.liftId;
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
                    step={tmStep}
                    min={tmStep}
                    suffix={settings.units.toUpperCase()}
                    label={`${LIFT_NAMES[liftId]} new TM`}
                  />
                  <Button variant="ghost" onClick={() => resetTo90(liftId)}>
                    Reset to 90%
                  </Button>
                </div>
                {badTmLifts.includes(liftId) && (
                  <p className="ccmodal__copy text-danger">{TM_REQUIRED_COPY}</p>
                )}
              </div>
            );
          })
        ) : (
          <>
            <p className="ccmodal__copy">{SL_SWITCH_IN_WEIGHT_COPY}</p>
            {SL_LIFTS.map((liftId) => (
              <div key={liftId} className="ccmodal__lift">
                <div className="ccmodal__lift-head">
                  <span className="label label-hi">{LIFT_NAMES[liftId]}</span>
                  {liftId === 'row' && carriedRow !== null && (
                    <span className="ccchip ccchip--hold label">
                      {carriedRowChipLabel(carriedRow, settings.units)}
                    </span>
                  )}
                </div>
                <div className="ccmodal__lift-edit">
                  <NumberStepper
                    value={slWeights[liftId]}
                    onChange={(v) => setSlWeights((p) => ({ ...p, [liftId]: v }))}
                    step={weightStep}
                    min={0}
                    suffix={settings.units.toUpperCase()}
                    label={`${LIFT_NAMES[liftId]} starting weight`}
                  />
                </div>
                {liftId === 'row' && <p className="ccmodal__copy">{SL_ROW_START_COPY}</p>}
                {blockingLifts.includes(liftId) && (
                  <p className="ccmodal__copy text-danger">
                    {liftId === 'row' ? SL_ROW_REQUIRED_COPY : SL_WEIGHT_REQUIRED_COPY}
                  </p>
                )}
                <div className="ccmodal__lift-edit">
                  <span className="label text-low">Increment</span>
                  <NumberStepper
                    value={slIncrements[liftId]}
                    onChange={(v) => setSlIncrements((p) => ({ ...p, [liftId]: v }))}
                    step={incStep}
                    min={incStep}
                    suffix={settings.units.toUpperCase()}
                    label={`${LIFT_NAMES[liftId]} increment`}
                  />
                </div>
                {liftId === 'deadlift' && (
                  <p className="ccmodal__copy">{slDeadliftIncrementCopy(settings.units)}</p>
                )}
              </div>
            ))}
            <KeepPrsToggle on={keepPrs} onToggle={() => setKeepPrs((k) => !k)} />
          </>
        )}

        <div className="ccmodal__actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            block
            onClick={confirm}
            disabled={busy || (choice === 'sl5x5' ? slSetupBlocked : tmsBlocked)}
          >
            {choice === 'sl5x5' ? 'Start 5×5 Block' : 'Confirm'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Mode B — completing a StrongLifts block
// ---------------------------------------------------------------------------

function SlCompleteModal({
  cycle,
  workouts,
  settings,
  onClose,
  onDone,
}: CompleteCycleModalProps) {
  const toast = useToast();
  const sl = cycle.sl!; // guarded by CompleteCycleModal
  const [choice, setChoice] = useState<'continue' | 'return'>(
    settings.pendingProgramSwitch === 'five31' ? 'return' : 'continue',
  );
  const [keepPrs, setKeepPrs] = useState(true);
  const [busy, setBusy] = useState(false);

  const best = useMemo(
    () => bestSlEffortsByLift(workouts, settings.units),
    [workouts, settings.units],
  );
  const suggestions = useMemo(
    () =>
      slReturnTmSuggestions(
        cycle.tms,
        {
          press: best.press?.e1rm ?? null,
          bench: best.bench?.e1rm ?? null,
          squat: best.squat?.e1rm ?? null,
          deadlift: best.deadlift?.e1rm ?? null,
        },
        settings.roundingIncrement,
      ),
    [cycle.tms, best, settings.roundingIncrement],
  );

  const [tms, setTms] = useState<Record<LiftId, number>>(() => {
    const init = {} as Record<LiftId, number>;
    for (const s of suggestions) init[s.liftId] = s.suggestedTm;
    return init;
  });

  const tmStep = settings.units === 'kg' ? 1.25 : 2.5;
  const badTmLifts = invalidTmLifts(
    tms,
    suggestions.map((s) => s.liftId),
  );
  const returnBlocked = badTmLifts.length > 0;

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (choice === 'return') {
        // Defence in depth; the button is disabled while this holds.
        if (returnBlocked) {
          setBusy(false);
          return;
        }
        // completeSlCycleReturn consumes the armed switch inside its txn.
        await completeSlCycleReturn(tms, keepPrs, cycle.id);
        onDone();
        toast.show('Back on 5/3/1 — training maxes are live again', 'success');
        return;
      }
      // CONTINUE declines any armed switch. completeSlCycleContinue deliberately
      // leaves Settings untouched, so the disarm has to happen here.
      await disarmIfArmed(settings);
      await completeSlCycleContinue(cycle.id);
      onDone();
      toast.show('Next 5×5 block started', 'success');
    } catch (err) {
      setBusy(false);
      toast.show(err instanceof Error ? err.message : 'Failed to complete block', 'danger');
    }
  };

  return (
    <Modal open onClose={onClose} title="Complete Block">
      <div className="ccmodal">
        <ProgramSegment
          options={[
            { value: 'continue', label: 'Continue 5×5' },
            { value: 'return', label: 'Return to 5/3/1' },
          ]}
          value={choice}
          onChange={setChoice}
        />
        {settings.pendingProgramSwitch === 'five31' && (
          <p className="ccmodal__copy text-cyan">
            A return to 5/3/1 was armed in Settings. Choosing Continue cancels it.
          </p>
        )}

        {choice === 'continue' ? (
          <>
            <p className="ccmodal__copy">
              The next block picks up exactly where this one left off — working weights and miss
              streaks carry over untouched.
            </p>
            {SL_LIFTS.map((liftId) => {
              const runtime = sl.lifts[liftId];
              return (
                <div key={liftId} className="ccmodal__lift-head">
                  <span className="label label-hi">{LIFT_NAMES[liftId]}</span>
                  <span className="sllift__load">
                    <span className="num text-amber">{fmtWeight(runtime.weight)}</span>
                    <span className="label text-mid">{settings.units.toUpperCase()}</span>
                    <span className="slcell__pips" aria-label={`${runtime.failStreak} of 3 misses`}>
                      {slStreakPips(runtime.failStreak).map((on, i) => (
                        <span key={i} className={`slpip${on ? ' is-on' : ''}`} aria-hidden="true" />
                      ))}
                    </span>
                  </span>
                </div>
              );
            })}
          </>
        ) : (
          <>
            <p className="ccmodal__copy">
              Training maxes wake up at the values you confirm here. A suggestion never LOWERS a TM.
            </p>
            {suggestions.map((s) => (
              <div key={s.liftId} className="ccmodal__lift">
                <div className="ccmodal__lift-head">
                  <span className="label label-hi">{LIFT_NAMES[s.liftId]}</span>
                  <span className={`ccchip ccchip--${s.basis === 'sl-e1rm' ? 'increase' : 'hold'} label`}>
                    {s.basis === 'sl-e1rm' ? 'Raised' : 'Held'}
                  </span>
                </div>
                <div className="ccmodal__lift-flow label text-mid">
                  <span className="num">{fmtWeight(s.currentTm)}</span>
                  <span className="ccmodal__arrow">→</span>
                  <span className="num text-amber">{fmtWeight(s.suggestedTm)}</span>
                </div>
                <p className="ccmodal__copy">{slReturnBasisCopy(s.basis, best[s.liftId])}</p>
                <div className="ccmodal__lift-edit">
                  <NumberStepper
                    value={tms[s.liftId]}
                    onChange={(v) => setTms((p) => ({ ...p, [s.liftId]: v }))}
                    step={tmStep}
                    min={tmStep}
                    suffix={settings.units.toUpperCase()}
                    label={`${LIFT_NAMES[s.liftId]} returning TM`}
                  />
                </div>
                {badTmLifts.includes(s.liftId) && (
                  <p className="ccmodal__copy text-danger">{TM_REQUIRED_COPY}</p>
                )}
              </div>
            ))}
            <KeepPrsToggle on={keepPrs} onToggle={() => setKeepPrs((k) => !k)} />
          </>
        )}

        <div className="ccmodal__actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            block
            onClick={confirm}
            disabled={busy || (choice === 'return' && returnBlocked)}
          >
            {/* Deliberately NOT the segment's wording: two controls labelled
                'Return to 5/3/1' in one dialog is a mis-tap waiting to happen. */}
            {choice === 'return' ? 'Confirm Return' : 'Start Next Block'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
