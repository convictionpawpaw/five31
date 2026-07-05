import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { AccessoryWork, MainSet, Settings, Workout } from '../../core/types.ts';
import { epley } from '../../core/e1rm.ts';
import { amrapTargetForPr } from '../../core/prs.ts';
import { db } from '../../db/db.ts';
import {
  finishWorkout,
  getSettings,
  logAccessorySet,
  logMainSet,
  setNotes,
  skipWorkout,
  startWorkout,
  unskipWorkout,
} from '../../db/repo/index.ts';
import { Button, HudPanel, Modal, NumberStepper, useToast } from '../../components/index.ts';
import { cycleTag, LIFT_NAMES, weekLabel } from '../shared/liftLabels.ts';
import { fmtTargetReps, fmtWeight } from '../shared/format.ts';
import { amrapSet } from '../shared/workoutSelect.ts';
import { bestE1rmForLift, countUnloggedSets } from './workoutHelpers.ts';
import { useWakeLock } from './useWakeLock.ts';
import './workout.css';

interface WorkoutData {
  settings: Settings | null;
  workout: Workout | null;
  liftWorkouts: Workout[];
  cycleActive: boolean;
}

function readWorkout(id: string) {
  return async (): Promise<WorkoutData> => {
    const settings = (await getSettings()) ?? null;
    const workout = (await db.workouts.get(id)) ?? null;
    let liftWorkouts: Workout[] = [];
    let cycleActive = false;
    if (workout) {
      liftWorkouts = await db.workouts.where('liftId').equals(workout.liftId).toArray();
      const cycle = await db.cycles.get(workout.cycleId);
      cycleActive = cycle?.status === 'active';
    }
    return { settings, workout, liftWorkouts, cycleActive };
  };
}

export function WorkoutScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const data = useLiveQuery(readWorkout(id ?? ''), [id]);

  const workout = data?.workout ?? null;
  const isPending = workout?.status === 'pending';

  // Hold the screen awake while an unfinished workout is open.
  const active = workout !== null && (workout.status === 'pending' || workout.status === 'in_progress');
  useWakeLock(active);

  // A pending workout is stamped to in_progress on mount so accessoryWork
  // materializes immediately (rather than only on the first set log).
  useEffect(() => {
    if (id && isPending) {
      void startWorkout(id).catch(() => {
        /* another interaction may have started it already */
      });
    }
  }, [id, isPending]);

  if (data === undefined) {
    return (
      <div className="workout">
        <p className="label workout__loading">Loading…</p>
      </div>
    );
  }

  if (workout === null || data.settings === null) {
    return (
      <div className="workout">
        <p className="label workout__loading">Workout not found.</p>
        <Button variant="ghost" onClick={() => navigate('/')}>
          Back to Today
        </Button>
      </div>
    );
  }

  const readOnly = workout.status === 'completed' || workout.status === 'skipped';

  return (
    <div className="workout safe-top">
      <WorkoutHeader workout={workout} />
      {readOnly ? (
        <ReadOnlyBody
          workout={workout}
          cycleActive={data.cycleActive}
          onUnskip={async () => {
            await unskipWorkout(workout.id);
            toast.show('Workout un-skipped', 'info');
          }}
        />
      ) : (
        <ActiveBody
          workout={workout}
          liftWorkouts={data.liftWorkouts}
          onFinished={(msg) => {
            navigate('/');
            toast.show(msg, 'success');
          }}
          onSkipped={() => {
            navigate('/');
            toast.show('Workout skipped', 'info');
          }}
        />
      )}
    </div>
  );
}

function WorkoutHeader({ workout }: { workout: Workout }) {
  return (
    <header className="workout__head">
      <h1 className="workout__lift num">{LIFT_NAMES[workout.liftId]}</h1>
      <p className="workout__meta label">
        Cycle {cycleTag(workout.cycleNumber)} · {weekLabel(workout.week)}
      </p>
      <p className="workout__tm label text-mid">
        TM {fmtWeight(workout.tmUsed)} {workout.units.toUpperCase()}
      </p>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Active (loggable) body
// ---------------------------------------------------------------------------

function ActiveBody({
  workout,
  liftWorkouts,
  onFinished,
  onSkipped,
}: {
  workout: Workout;
  liftWorkouts: Workout[];
  onFinished: (msg: string) => void;
  onSkipped: () => void;
}) {
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [busy, setBusy] = useState(false);

  const warmups = workout.mainSets.filter((s) => s.kind === 'warmup');
  const workSets = workout.mainSets.filter((s) => s.kind === 'work');
  const amrap = amrapSet(workout);
  const nonAmrapWork = workSets.filter((s) => !s.amrap);

  const unlogged = countUnloggedSets(workout);

  const doFinish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await finishWorkout(workout.id);
      const progressed = workout.accessoryWork.filter((a) =>
        allSetsHitMax(a),
      );
      let msg = `${LIFT_NAMES[workout.liftId]} logged`;
      if (progressed.length > 0) {
        msg += ` · ${progressed.map((a) => a.name).join(', ')} +increment next session`;
      }
      onFinished(msg);
    } catch (err) {
      setBusy(false);
      throw err;
    }
  };

  const requestFinish = () => {
    if (unlogged > 0) {
      setConfirmFinish(true);
    } else {
      void doFinish();
    }
  };

  const doSkip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await skipWorkout(workout.id);
      onSkipped();
    } catch (err) {
      setBusy(false);
      throw err;
    }
  };

  return (
    <>
      {warmups.length > 0 && <WarmupGroup workout={workout} warmups={warmups} />}

      <section className="workout__section">
        <h2 className="workout__section-title label">Work Sets</h2>
        {nonAmrapWork.map((s) => (
          <WorkSetRow key={`work-${s.index}`} workout={workout} set={s} />
        ))}
        {amrap && <AmrapRow workout={workout} set={amrap} liftWorkouts={liftWorkouts} />}
      </section>

      {workout.accessoryWork.length > 0 && (
        <section className="workout__section">
          <h2 className="workout__section-title label">Accessories</h2>
          {workout.accessoryWork.map((a, i) => (
            <AccessoryRow key={a.accessoryId} workout={workout} accessory={a} accessoryIndex={i} />
          ))}
        </section>
      )}

      <NotesField workout={workout} />

      <div className="workout__finishbar-spacer" />
      <div className="workout__finishbar safe-bottom">
        <Button variant="danger" onClick={() => setConfirmSkip(true)} disabled={busy}>
          Skip
        </Button>
        <Button variant="primary" block onClick={requestFinish} disabled={busy}>
          Finish
        </Button>
      </div>

      <Modal open={confirmFinish} onClose={() => setConfirmFinish(false)} title="Finish workout?">
        <p className="workout__modal-copy label text-mid">
          {unlogged} {unlogged === 1 ? 'set' : 'sets'} unlogged — finish anyway?
        </p>
        <div className="workout__modal-actions">
          <Button variant="ghost" onClick={() => setConfirmFinish(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            block
            disabled={busy}
            onClick={() => {
              setConfirmFinish(false);
              void doFinish();
            }}
          >
            Finish
          </Button>
        </div>
      </Modal>

      <Modal open={confirmSkip} onClose={() => setConfirmSkip(false)} title="Skip workout?">
        <p className="workout__modal-copy label text-mid">
          Skipping counts as resolved and is excluded from progress. You can un-skip while the
          cycle is active.
        </p>
        <div className="workout__modal-actions">
          <Button variant="ghost" onClick={() => setConfirmSkip(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            block
            disabled={busy}
            onClick={() => {
              setConfirmSkip(false);
              void doSkip();
            }}
          >
            Skip Workout
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** Whether every set of an accessory hit at least the top of its rep range. */
function allSetsHitMax(a: AccessoryWork): boolean {
  if (a.setReps.length < a.targetSets) return false;
  for (let i = 0; i < a.targetSets; i++) {
    const r = a.setReps[i];
    if (r === null || r === undefined || r < a.repRangeMax) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Warmups
// ---------------------------------------------------------------------------

function WarmupGroup({ workout, warmups }: { workout: Workout; warmups: MainSet[] }) {
  const [open, setOpen] = useState(false);
  const loggedCount = warmups.filter((s) => s.actualReps !== undefined).length;

  const logAll = async () => {
    for (const s of warmups) {
      if (s.actualReps === undefined) {
        await logMainSet(workout.id, 'warmup', s.index, s.targetReps);
      }
    }
  };

  return (
    <section className="workout__section">
      <button
        type="button"
        className="workout__warmup-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="label">Warmups</span>
        <span className="label text-low">
          {loggedCount}/{warmups.length} · {open ? '−' : '+'}
        </span>
      </button>
      <Button variant="ghost" block className="workout__logall" onClick={() => void logAll()}>
        Log All Warmups
      </Button>
      {open && (
        <div className="workout__warmup-list">
          {warmups.map((s) => (
            <WorkSetRow key={`warmup-${s.index}`} workout={workout} set={s} />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Work / warmup set row (tap to log target, tap again to adjust)
// ---------------------------------------------------------------------------

function WorkSetRow({ workout, set }: { workout: Workout; set: MainSet }) {
  const [editing, setEditing] = useState(false);
  const logged = set.actualReps !== undefined;
  const [reps, setReps] = useState<number>(set.actualReps ?? set.targetReps);

  const onTap = () => {
    if (!logged) {
      void logMainSet(workout.id, set.kind, set.index, set.targetReps);
    } else {
      setReps(set.actualReps ?? set.targetReps);
      setEditing((e) => !e);
    }
  };

  const commit = (next: number) => {
    setReps(next);
    void logMainSet(workout.id, set.kind, set.index, next);
  };

  return (
    <div className={`setrow${logged ? ' is-logged' : ''}`}>
      <button type="button" className="setrow__main" onClick={onTap}>
        <span className="num setrow__weight">{fmtWeight(set.weight)}</span>
        <span className="label setrow__unit">{workout.units.toUpperCase()}</span>
        <span className="setrow__x label">×</span>
        <span className="num setrow__reps">
          {logged ? set.actualReps : fmtTargetReps(set.targetReps, set.amrap)}
        </span>
        {logged && <span className="label setrow__target">/ {set.targetReps}</span>}
      </button>
      {editing && logged && (
        <div className="setrow__editor">
          <NumberStepper value={reps} onChange={commit} step={1} min={0} label="Reps" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AMRAP row — big stepper + live e1RM readout + PR hint
// ---------------------------------------------------------------------------

function AmrapRow({
  workout,
  set,
  liftWorkouts,
}: {
  workout: Workout;
  set: MainSet;
  liftWorkouts: Workout[];
}) {
  const [reps, setReps] = useState<number>(set.actualReps ?? set.targetReps);
  const logged = set.actualReps !== undefined;

  const bestE1rm = useMemo(
    () => bestE1rmForLift(liftWorkouts, workout.liftId, workout.units, workout.id),
    [liftWorkouts, workout.liftId, workout.units, workout.id],
  );

  const e1 = epley(set.weight, reps);
  const prTarget = amrapTargetForPr(set.weight, bestE1rm);

  const commit = () => {
    void logMainSet(workout.id, 'work', set.index, reps);
  };

  return (
    <div className={`amrap glow-amber${logged ? ' is-logged' : ''}`}>
      <div className="amrap__head">
        <span className="label amrap__label">AMRAP · Top Set</span>
        <span className="amrap__prescription">
          <span className="num num-md text-amber">{fmtWeight(set.weight)}</span>
          <span className="label text-mid">
            {workout.units.toUpperCase()} × {fmtTargetReps(set.targetReps, true)}
          </span>
        </span>
      </div>

      <NumberStepper value={reps} onChange={setReps} step={1} min={0} label="AMRAP reps" />

      <div className="amrap__readout">
        <span className="label text-mid">
          e1RM{' '}
          <span className="text-cyan">
            {e1 === null ? '—' : `${fmtWeight(e1)} ${workout.units.toUpperCase()}`}
          </span>
        </span>
        {prTarget !== null && (
          <span className="label amrap__pr-hint">
            ≥ {prTarget} {prTarget === 1 ? 'rep' : 'reps'} = new record
          </span>
        )}
      </div>

      <Button variant="primary" block onClick={commit}>
        {logged ? `Update — ${reps} reps` : `Log — ${reps} reps`}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accessory row — one chip per set
// ---------------------------------------------------------------------------

function AccessoryRow({
  workout,
  accessory,
  accessoryIndex,
}: {
  workout: Workout;
  accessory: AccessoryWork;
  accessoryIndex: number;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const willProgress = allSetsHitMax(accessory);

  return (
    <div className="accrow">
      <div className="accrow__head">
        <span className="label label-hi">{accessory.name}</span>
        <span className="label text-mid">
          {accessory.repRangeMin}-{accessory.repRangeMax} @ {fmtWeight(accessory.weight)}{' '}
          {workout.units.toUpperCase()}
        </span>
      </div>
      <div className="accrow__chips">
        {accessory.setReps.map((reps, si) => (
          <AccessoryChip
            key={si}
            workout={workout}
            accessory={accessory}
            accessoryIndex={accessoryIndex}
            setIndex={si}
            reps={reps}
            editing={editing === si}
            onEdit={() => setEditing((cur) => (cur === si ? null : si))}
          />
        ))}
      </div>
      {editing !== null && (
        <div className="accrow__editor">
          <NumberStepper
            value={accessory.setReps[editing] ?? accessory.repRangeMax}
            onChange={(next) => {
              void logAccessorySet(workout.id, accessoryIndex, editing, next);
            }}
            step={1}
            min={0}
            label="Accessory reps"
          />
        </div>
      )}
      {willProgress && <p className="accrow__progress label text-cyan">+ Increment next session</p>}
    </div>
  );
}

function AccessoryChip({
  workout,
  accessory,
  accessoryIndex,
  setIndex,
  reps,
  editing,
  onEdit,
}: {
  workout: Workout;
  accessory: AccessoryWork;
  accessoryIndex: number;
  setIndex: number;
  reps: number | null;
  editing: boolean;
  onEdit: () => void;
}) {
  const logged = reps !== null;
  const onTap = () => {
    if (!logged) {
      // First tap logs top-of-range reps.
      void logAccessorySet(workout.id, accessoryIndex, setIndex, accessory.repRangeMax);
    } else {
      onEdit();
    }
  };
  return (
    <button
      type="button"
      className={`accchip${logged ? ' is-logged' : ''}${editing ? ' is-editing' : ''}`}
      onClick={onTap}
      aria-label={`Set ${setIndex + 1}`}
    >
      <span className="num accchip__reps">{logged ? reps : '·'}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function NotesField({ workout }: { workout: Workout }) {
  const [open, setOpen] = useState((workout.notes ?? '').length > 0);
  const [text, setText] = useState(workout.notes ?? '');

  return (
    <section className="workout__section">
      <button
        type="button"
        className="workout__notes-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="label">Notes</span>
        <span className="label text-low">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <textarea
          className="workout__notes"
          value={text}
          placeholder="How did it feel?"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void setNotes(workout.id, text)}
          rows={3}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Read-only (completed / skipped) body
// ---------------------------------------------------------------------------

function ReadOnlyBody({
  workout,
  cycleActive,
  onUnskip,
}: {
  workout: Workout;
  cycleActive: boolean;
  onUnskip: () => void;
}) {
  const workSets = workout.mainSets.filter((s) => s.kind === 'work');
  const isSkipped = workout.status === 'skipped';

  return (
    <>
      <HudPanel title={isSkipped ? 'Skipped' : 'Completed'} className="workout__ro">
        {isSkipped ? (
          <p className="label text-mid">This workout was skipped.</p>
        ) : (
          <div className="workout__ro-sets">
            {workSets.map((s) => (
              <div key={`work-${s.index}`} className="workout__ro-row">
                <span className="num">{fmtWeight(s.weight)}</span>
                <span className="label text-mid">{workout.units.toUpperCase()}</span>
                <span className="label text-low">×</span>
                <span className="num">
                  {s.actualReps ?? '—'}
                  {s.amrap ? '+' : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </HudPanel>

      {isSkipped && cycleActive && (
        <Button variant="ghost" block onClick={onUnskip}>
          Un-skip Workout
        </Button>
      )}

      <p className="label text-low workout__ro-note">Edit reps &amp; notes in History.</p>
    </>
  );
}
