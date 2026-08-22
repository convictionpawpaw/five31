import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type {
  Cycle,
  MainSet,
  SlCycleState,
  SlLiftRuntime,
  Settings,
  Workout,
} from '../../core/types.ts';
import { SL_SESSIONS_PER_CYCLE, slSetCount } from '../../core/sl.ts';
import { db } from '../../db/db.ts';
import {
  earliestUnresolvedSlSession,
  finishSlSession,
  getSettings,
  logSlSet,
  setNotes,
  skipSlSession,
  startSlSession,
  unskipSlSession,
  type SlLiftOutcome,
} from '../../db/repo/index.ts';
import { Button, HudPanel, Modal, NumberStepper, useToast } from '../../components/index.ts';
import { LIFT_NAMES, cycleTag, slSessionHeading } from '../shared/liftLabels.ts';
import { fmtWeight } from '../shared/format.ts';
import { useWakeLock } from '../workout/useWakeLock.ts';
import {
  buildSlSessionView,
  canUnskipSlSession,
  countUnloggedSlSets,
  previewSlLiftOutcome,
  slOutcomeCopy,
  slSessionMode,
  slSessionRows,
  type SlLiftView,
  type SlOutcomeLike,
  type SlSessionView,
} from './slView.ts';
import './sl.css';

interface SlSessionData {
  settings: Settings | null;
  cycle: Cycle | null;
  workouts: Workout[];
  cycleActive: boolean;
}

function readSlSession(cycleId: string) {
  return async (): Promise<SlSessionData> => {
    const settings = (await getSettings()) ?? null;
    const cycle = (await db.cycles.get(cycleId)) ?? null;
    const workouts = cycle ? await db.workouts.where('cycleId').equals(cycle.id).toArray() : [];
    return { settings, cycle, workouts, cycleActive: cycle?.status === 'active' };
  };
}

/**
 * The StrongLifts session logger — the SL counterpart of WorkoutScreen.
 *
 * A StrongLifts session is trained as a UNIT (three lifts, squat first), so the
 * whole session is one screen: one start, one finish, one skip. Weights are
 * lazy, which produces the screen's three modes:
 *   - 'log'       the current session; the first chip tap stamps all three rows.
 *   - 'projected' a later session; weights are forecasts and nothing is loggable.
 *   - 'resolved'  completed or skipped; read-only, with un-skip where allowed.
 *
 * NOTES: there is ONE notes field per session, deliberately bound to the SQUAT
 * row's `notes`. Squat is the only lift present in every session, so it is the
 * one stable place to hang a session-level note; per-lift notes would fragment
 * a single thought across three records, and History still surfaces it on the
 * squat row where it lives. This is a documented modelling choice, not an
 * oversight.
 */
export function SlSessionScreen() {
  const { cycleId, n } = useParams<{ cycleId: string; n: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const data = useLiveQuery(readSlSession(cycleId ?? ''), [cycleId]);
  /**
   * The finish summary is held HERE, not in LogBody. Finishing flips the session
   * to 'resolved', which unmounts LogBody on the very next live-query tick — a
   * modal owned by that subtree would vanish before it could be read.
   */
  const [outcomes, setOutcomes] = useState<SlLiftOutcome[] | null>(null);

  const session = Number(n);
  const validSession =
    Number.isInteger(session) && session >= 1 && session <= SL_SESSIONS_PER_CYCLE;

  const rows = data ? slSessionRows(data.workouts, validSession ? session : 1) : [];
  const unresolved = rows.some((w) => w.status === 'pending' || w.status === 'in_progress');
  useWakeLock(unresolved);

  if (data === undefined) {
    return (
      <div className="slsession">
        <p className="label slsession__loading">Loading…</p>
      </div>
    );
  }

  const { settings, cycle, workouts } = data;
  const sl = cycle?.sl;

  if (settings === null || cycle === null || cycle.program !== 'sl5x5' || sl === undefined) {
    return (
      <div className="slsession">
        <p className="label slsession__loading">StrongLifts session not found.</p>
        <Button variant="ghost" onClick={() => navigate('/')}>
          Back to Today
        </Button>
      </div>
    );
  }
  if (!validSession) {
    return (
      <div className="slsession">
        <p className="label slsession__loading">Session {n} is out of range (1–12).</p>
        <Button variant="ghost" onClick={() => navigate('/cycle')}>
          Back to Cycle
        </Button>
      </div>
    );
  }

  const current = earliestUnresolvedSlSession(workouts);
  const mode = slSessionMode(session, current, rows);
  const view = buildSlSessionView(workouts, session, sl);

  return (
    <div className="slsession safe-top">
      <header className="slsession__head">
        <h1 className="slsession__title num">{slSessionHeading(session, view.slot, view.week)}</h1>
        <p className="slsession__meta label">
          Cycle {cycleTag(cycle.number)} · StrongLifts 5×5
        </p>
      </header>

      {mode === 'resolved' ? (
        <ResolvedBody
          view={view}
          workouts={workouts}
          session={session}
          cycleId={cycle.id}
          cycleActive={data.cycleActive}
          onUnskipped={() => toast.show('Session un-skipped', 'info')}
        />
      ) : mode === 'projected' ? (
        <ProjectedBody view={view} current={current} onGoCurrent={(s) => navigate(`/sl-session/${cycle.id}/${s}`)} />
      ) : (
        <LogBody
          view={view}
          rows={rows}
          cycleId={cycle.id}
          session={session}
          roundingIncrement={settings.roundingIncrement}
          sl={sl}
          onFinished={setOutcomes}
          onSkipped={() => {
            navigate('/');
            toast.show('Session skipped', 'info');
          }}
        />
      )}

      <SessionOutcomesModal
        outcomes={outcomes}
        onClose={() => {
          setOutcomes(null);
          navigate('/');
          toast.show('Session logged', 'success');
        }}
      />
    </div>
  );
}

/** The per-lift verdicts the finish just wrote — the last word on the session. */
function SessionOutcomesModal({
  outcomes,
  onClose,
}: {
  outcomes: SlLiftOutcome[] | null;
  onClose: () => void;
}) {
  return (
    <Modal open={outcomes !== null} onClose={onClose} title="Session logged">
      <div className="sloutcomes">
        {(outcomes ?? []).map((o) => (
          <div key={o.liftId} className="sloutcome">
            <span className="label label-hi">{LIFT_NAMES[o.liftId]}</span>
            <span className={`sllift__verdict sllift__verdict--${verdictKind(o)}`}>
              {slOutcomeCopy(o)}
            </span>
          </div>
        ))}
      </div>
      <Button variant="primary" block onClick={onClose}>
        Done
      </Button>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Loggable body
// ---------------------------------------------------------------------------

function LogBody({
  view,
  rows,
  cycleId,
  session,
  roundingIncrement,
  sl,
  onFinished,
  onSkipped,
}: {
  view: SlSessionView;
  rows: Workout[];
  cycleId: string;
  session: number;
  roundingIncrement: number;
  sl: SlCycleState;
  /** Hands the finish's verdicts to the screen, which owns the summary modal. */
  onFinished: (outcomes: SlLiftOutcome[]) => void;
  onSkipped: () => void;
}) {
  const toast = useToast();
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [busy, setBusy] = useState(false);

  const started = view.lifts.some((l) => l.basis === 'stamped');
  const unlogged = countUnloggedSlSets(rows);

  /**
   * The FIRST real logging interaction stamps the whole session. Merely viewing
   * it must never start it, which is why this is called from the chip tap and
   * the note save — never from the render path.
   */
  const ensureStarted = async (): Promise<void> => {
    if (!started) await startSlSession(cycleId, session);
  };

  const doFinish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await ensureStarted();
      onFinished(await finishSlSession(cycleId, session));
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Finish failed', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const doSkip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await skipSlSession(cycleId, session);
      onSkipped();
    } catch (err) {
      setBusy(false);
      toast.show(err instanceof Error ? err.message : 'Skip failed', 'danger');
    }
  };

  return (
    <>
      {view.lifts.map((lift) => (
        <LiftSection
          key={lift.liftId}
          lift={lift}
          roundingIncrement={roundingIncrement}
          before={sl.lifts[lift.liftId]}
          ensureStarted={ensureStarted}
        />
      ))}

      <SessionNotes view={view} ensureStarted={ensureStarted} />

      <div className="slsession__finishbar-spacer" />
      <div className="slsession__finishbar safe-bottom">
        <Button variant="danger" onClick={() => setConfirmSkip(true)} disabled={busy}>
          Skip
        </Button>
        <Button
          variant="primary"
          block
          disabled={busy}
          onClick={() => (unlogged > 0 ? setConfirmFinish(true) : void doFinish())}
        >
          Finish
        </Button>
      </div>

      <Modal open={confirmFinish} onClose={() => setConfirmFinish(false)} title="Finish session?">
        <p className="slsession__modal-copy">
          {unlogged} {unlogged === 1 ? 'set is' : 'sets are'} unlogged — unlogged sets count as a
          miss. Finish anyway?
        </p>
        <div className="slsession__modal-actions">
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

      <Modal open={confirmSkip} onClose={() => setConfirmSkip(false)} title="Skip session?">
        <p className="slsession__modal-copy">
          All three lifts are skipped together. Skipping neither progresses a lift nor counts as a
          miss — the block's weights stay exactly where they are. You can un-skip while no later
          session has started.
        </p>
        <div className="slsession__modal-actions">
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
            Skip Session
          </Button>
        </div>
      </Modal>

    </>
  );
}

/** Which of the three verdict tones a lift outcome carries. */
function verdictKind(o: SlOutcomeLike): 'pass' | 'miss' | 'deload' {
  if (o.deloaded) return 'deload';
  return o.passed ? 'pass' : 'miss';
}

// ---------------------------------------------------------------------------
// One lift: header + set chips + live verdict
// ---------------------------------------------------------------------------

function LiftSection({
  lift,
  roundingIncrement,
  before,
  ensureStarted,
}: {
  lift: SlLiftView;
  roundingIncrement: number;
  /** The lift's runtime BEFORE this session — the preview's starting point. */
  before: SlLiftRuntime;
  ensureStarted: () => Promise<void>;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<number | null>(null);
  const units = lift.workout.units.toUpperCase();

  // The verdict the finish would write, computed live from the same two core
  // calls finishSlSession makes — so preview and write can never disagree.
  const outcome = lift.allLogged
    ? previewSlLiftOutcome(lift.liftId, before, lift.sets, roundingIncrement)
    : null;

  const tap = async (set: MainSet) => {
    try {
      if (lift.basis !== 'stamped') {
        // First interaction on the session: stamp all three rows, then log.
        await ensureStarted();
        await logSlSet(lift.workout.id, set.index, set.targetReps);
        return;
      }
      if (set.actualReps === undefined) {
        await logSlSet(lift.workout.id, set.index, set.targetReps);
      } else {
        setEditing((cur) => (cur === set.index ? null : set.index));
      }
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Could not log the set', 'danger');
    }
  };

  return (
    <section className="sllift">
      <div className="sllift__head">
        <span className="label label-hi sllift__name">{LIFT_NAMES[lift.liftId]}</span>
        <span className="sllift__load">
          <span className="num sllift__weight">{fmtWeight(lift.weight)}</span>
          <span className="label sllift__unit">{units}</span>
          <span className="label sllift__scheme">
            {slSetCount(lift.liftId)}×5
          </span>
        </span>
      </div>

      <div className="sllift__chips">
        {lift.sets.map((set) => (
          <SetChip
            key={set.index}
            set={set}
            onTap={() => void tap(set)}
            editing={editing === set.index}
          />
        ))}
      </div>

      {editing !== null && lift.basis === 'stamped' && (
        <div className="sllift__editor">
          <NumberStepper
            value={lift.sets.find((s) => s.index === editing)?.actualReps ?? 5}
            onChange={(next) => {
              void logSlSet(lift.workout.id, editing, next);
            }}
            step={1}
            min={0}
            label={`${LIFT_NAMES[lift.liftId]} set ${editing + 1} reps`}
          />
        </div>
      )}

      {outcome && (
        <p className={`sllift__verdict sllift__verdict--${verdictKind(outcome)}`}>
          {slOutcomeCopy(outcome)}
        </p>
      )}
    </section>
  );
}

function SetChip({
  set,
  onTap,
  editing,
  disabled = false,
}: {
  set: MainSet;
  onTap: () => void;
  editing: boolean;
  disabled?: boolean;
}) {
  const logged = set.actualReps !== undefined;
  const short = logged && set.actualReps! < set.targetReps;
  const classes = [
    'slchip',
    logged ? 'is-logged' : '',
    short ? 'is-short' : '',
    editing ? 'is-editing' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={classes}
      onClick={onTap}
      disabled={disabled}
      aria-label={`Set ${set.index + 1}${logged ? `, ${set.actualReps} reps` : ''}`}
    >
      <span className="num slchip__reps">{logged ? set.actualReps : '·'}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Notes — ONE field per session, stored on the squat row (see the file header)
// ---------------------------------------------------------------------------

function SessionNotes({
  view,
  ensureStarted,
}: {
  view: SlSessionView;
  ensureStarted: () => Promise<void>;
}) {
  // Squat leads every session, so its row is the session's stable note anchor.
  const anchor = view.lifts.find((l) => l.liftId === 'squat')?.workout ?? view.lifts[0]?.workout;
  const [open, setOpen] = useState((anchor?.notes ?? '').length > 0);
  const [text, setText] = useState(anchor?.notes ?? '');

  if (!anchor) return null;

  const save = async () => {
    // Never write a note to a session the user only looked at.
    if (anchor.status === 'pending' && text.trim().length === 0) return;
    await ensureStarted();
    await setNotes(anchor.id, text);
  };

  return (
    <section>
      <button
        type="button"
        className="slsession__notes-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="label">Session Notes</span>
        <span className="label text-low">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <textarea
          className="slsession__notes"
          value={text}
          placeholder="How did the session feel?"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void save()}
          rows={3}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Projected (later session) — view only
// ---------------------------------------------------------------------------

function ProjectedBody({
  view,
  current,
  onGoCurrent,
}: {
  view: SlSessionView;
  current: number | null;
  onGoCurrent: (session: number) => void;
}) {
  return (
    <>
      <div className="slsession__notice">
        <p className="slsession__notice-copy">
          {current === null
            ? 'This block is finished — every session is resolved.'
            : `Weights are projected: they assume every session up to this one is passed. Finish session ${current} first.`}
        </p>
      </div>

      {view.lifts.map((lift) => (
        <section key={lift.liftId} className="sllift sllift--projected">
          <div className="sllift__head">
            <span className="label label-hi sllift__name">{LIFT_NAMES[lift.liftId]}</span>
            <span className="sllift__load">
              <span className="num sllift__weight">{fmtWeight(lift.weight)}</span>
              <span className="label sllift__unit">{lift.workout.units.toUpperCase()}</span>
              {lift.basis === 'projected' && <span className="label sltag">Projected</span>}
            </span>
          </div>
          <div className="sllift__chips">
            {lift.sets.map((set) => (
              <SetChip key={set.index} set={set} onTap={() => {}} editing={false} disabled />
            ))}
          </div>
        </section>
      ))}

      {current !== null && (
        <Button variant="primary" block onClick={() => onGoCurrent(current)}>
          Go to Session {String(current).padStart(2, '0')} →
        </Button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Resolved (completed / skipped) — read-only summary
// ---------------------------------------------------------------------------

function ResolvedBody({
  view,
  workouts,
  session,
  cycleId,
  cycleActive,
  onUnskipped,
}: {
  view: SlSessionView;
  workouts: Workout[];
  session: number;
  cycleId: string;
  cycleActive: boolean;
  onUnskipped: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmUnskip, setConfirmUnskip] = useState(false);
  const skipped = view.status === 'skipped';
  const canUnskip = cycleActive && canUnskipSlSession(workouts, session);
  // The session note lives on the squat row (see the file header).
  const note = view.lifts.find((l) => l.liftId === 'squat')?.workout.notes;

  const doUnskip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await unskipSlSession(cycleId, session);
      setConfirmUnskip(false);
      onUnskipped();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Un-skip failed', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <HudPanel title={skipped ? 'Skipped' : 'Completed'}>
        {skipped ? (
          <p className="slsession__modal-copy">
            This session was skipped. No lift progressed and no miss was recorded.
          </p>
        ) : (
          <div className="slsession__ro-sets">
            {view.lifts.map((lift) => (
              <div key={lift.liftId} className="slsession__ro-row">
                <span className="label label-hi">{LIFT_NAMES[lift.liftId]}</span>
                <span className="slsession__ro-sets">
                  <span className="num">{fmtWeight(lift.weight)}</span>
                  <span className="label text-mid">{lift.workout.units.toUpperCase()}</span>
                  <span className="label text-low">×</span>
                  <span className="num">
                    {lift.sets.map((s) => s.actualReps ?? '—').join(' / ')}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </HudPanel>

      {note !== undefined && note.length > 0 && (
        <HudPanel title="Session Notes">
          <p className="slsession__modal-copy">{note}</p>
        </HudPanel>
      )}

      {skipped && canUnskip && (
        <Button variant="ghost" block onClick={() => setConfirmUnskip(true)} disabled={busy}>
          Un-skip Session
        </Button>
      )}

      <p className="label text-low slsession__ro-note">Edit reps &amp; notes in History.</p>

      <Modal open={confirmUnskip} onClose={() => setConfirmUnskip(false)} title="Un-skip session?">
        <p className="slsession__modal-copy">
          The three rows go back to pending and any reps entered before the skip are discarded. The
          session re-stamps at the block&apos;s current weights when you next start it.
        </p>
        <div className="slsession__modal-actions">
          <Button variant="ghost" onClick={() => setConfirmUnskip(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" block onClick={() => void doUnskip()} disabled={busy}>
            Un-skip
          </Button>
        </div>
      </Modal>
    </>
  );
}
