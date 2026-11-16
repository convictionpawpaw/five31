import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { BodyweightEntry, Cycle, SlCycleState, Settings, Workout } from '../../core/types.ts';
import { effortSet } from '../../core/efforts.ts';
import { db } from '../../db/db.ts';
import {
  earliestUnresolvedSlSession,
  getActiveCycle,
  getCycleWorkouts,
  getSettings,
  listBodyweight,
  upsertBodyweight,
} from '../../db/repo/index.ts';
import { Button, HudPanel, NumberStepper, PrBadge, useToast } from '../../components/index.ts';
import { cycleTag, LIFT_NAMES, slSessionHeading, weekLabel } from '../shared/liftLabels.ts';
import { fmtTargetReps, fmtWeight, fmtWeightOrDash } from '../shared/format.ts';
import {
  isCycleResolved,
  lastCompletedWorkout,
  selectNextWorkout,
  topWorkSet,
} from '../shared/workoutSelect.ts';
import { workoutSetPr } from '../workout/workoutHelpers.ts';
import { buildSlSessionView, lastCompletedSlSession, slSessionRows } from '../sl/slView.ts';
import { localIsoDate } from '../../core/localDate.ts';
import { StretchTodayPanel } from '../stretch/StretchTodayPanel.tsx';
import { nextWarmupLift } from '../stretch/nextLift.ts';
import { bodyweightSeed, bodyweightStep } from './bodyweightSeed.ts';
import '../sl/sl.css';
import './today.css';

interface TodayData {
  settings: Settings | null;
  cycle: Cycle | null;
  workouts: Workout[];
  /** Every workout across all cycles — needed for a true cross-cycle PR check. */
  allWorkouts: Workout[];
  /** The newest entry WITH its own units — the seed is converted from them. */
  lastBodyweight: BodyweightEntry | null;
}

async function readToday(): Promise<TodayData> {
  const settings = (await getSettings()) ?? null;
  const cycle = (await getActiveCycle()) ?? null;
  const workouts = cycle ? await getCycleWorkouts(cycle.id) : [];
  const allWorkouts = await db.workouts.toArray();
  const bw = await listBodyweight();
  const lastBodyweight = bw.length > 0 ? bw[bw.length - 1]! : null;
  return { settings, cycle, workouts, allWorkouts, lastBodyweight };
}

export function TodayScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const data = useLiveQuery(() => readToday(), []);

  if (data === undefined) {
    return (
      <div className="today">
        <p className="label today__loading">Loading…</p>
      </div>
    );
  }

  const { settings, cycle, workouts, allWorkouts, lastBodyweight } = data;
  if (settings === null || cycle === null) {
    return (
      <div className="today">
        <p className="label today__loading">No active cycle.</p>
        <StretchTodayPanel />
      </div>
    );
  }

  const resets = settings.prResets ?? [];
  const sl = cycle.program === 'sl5x5' ? cycle.sl : undefined;

  return (
    <div className="today safe-top">
      <header className="today__head">
        <h1 className="today__brand num">FIVE31</h1>
        <p className="today__sub label">
          Cycle {cycleTag(cycle.number)}
          {sl ? ' · 5×5' : ''}
        </p>
      </header>

      {sl ? (
        <SlToday
          sl={sl}
          workouts={workouts}
          allWorkouts={allWorkouts}
          resets={resets}
          onOpen={(session) => navigate(`/sl-session/${cycle.id}/${session}`)}
          onComplete={() => navigate('/cycle')}
        />
      ) : (
        <ClassicToday
          settings={settings}
          cycleNumber={cycle.number}
          workouts={workouts}
          allWorkouts={allWorkouts}
          resets={resets}
          onOpen={(id) => navigate(`/workout/${id}`)}
          onComplete={() => navigate('/cycle')}
        />
      )}

      <StretchTodayPanel warmupLift={nextWarmupLift(settings, cycle, workouts)} />

      {/* Keyed by units so a unit switch re-seeds the stepper in the new units. */}
      <BodyweightQuickLog
        key={settings.units}
        units={settings.units}
        seed={bodyweightSeed(lastBodyweight, settings.units)}
        onSaved={() => toast.show('Bodyweight saved', 'success')}
        onError={(msg) => toast.show(msg, 'danger')}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Classic 5/3/1 branch — unchanged behaviour
// ---------------------------------------------------------------------------

function ClassicToday({
  settings,
  cycleNumber,
  workouts,
  allWorkouts,
  resets,
  onOpen,
  onComplete,
}: {
  settings: Settings;
  cycleNumber: number;
  workouts: Workout[];
  allWorkouts: Workout[];
  resets: readonly string[];
  onOpen: (id: string) => void;
  onComplete: () => void;
}) {
  const next = selectNextWorkout(workouts, settings.dayOrder);
  const resolved = isCycleResolved(workouts);
  const last = lastCompletedWorkout(workouts);

  return (
    <>
      {resolved ? (
        <CycleCompleteCard onGo={onComplete} />
      ) : next ? (
        <NextWorkoutCard
          workout={next}
          cycleNumber={cycleNumber}
          onStart={() => onOpen(next.id)}
        />
      ) : (
        <HudPanel title="Today">
          <p className="label text-mid">No workouts in this cycle.</p>
        </HudPanel>
      )}

      {last && <LastWorkoutSummary workout={last} workouts={allWorkouts} resets={resets} />}
    </>
  );
}

function NextWorkoutCard({
  workout,
  cycleNumber,
  onStart,
}: {
  workout: Workout;
  cycleNumber: number;
  onStart: () => void;
}) {
  const top = topWorkSet(workout);
  const resuming = workout.status === 'in_progress';
  return (
    <HudPanel active className="today__hero">
      <p className="today__hero-meta label">
        Cycle {cycleTag(cycleNumber)} · {weekLabel(workout.week)} · {LIFT_NAMES[workout.liftId]}
      </p>
      {top && (
        <div className="today__topset">
          <span className="today__topset-label label">Top Set</span>
          <span className="num num-xl text-amber">{fmtWeight(top.weight)}</span>
          <span className="today__topset-unit label">
            {workout.units.toUpperCase()} × {fmtTargetReps(top.targetReps, top.amrap)}
          </span>
        </div>
      )}
      <Button variant="primary" block className="today__start" onClick={onStart}>
        {resuming ? 'Resume' : 'Start'}
      </Button>
    </HudPanel>
  );
}

function CycleCompleteCard({ onGo }: { onGo: () => void }) {
  return (
    <HudPanel active className="today__hero">
      <p className="today__hero-meta label text-cyan">Cycle Complete</p>
      <p className="today__complete-copy label text-mid">
        Every workout resolved. Advance training maxes and open the next cycle.
      </p>
      <Button variant="primary" block className="today__start" onClick={onGo}>
        Complete Cycle →
      </Button>
    </HudPanel>
  );
}

function LastWorkoutSummary({
  workout,
  workouts,
  resets,
}: {
  workout: Workout;
  workouts: Workout[];
  resets: readonly string[];
}) {
  const effort = effortSet(workout);
  const isPr = useMemo(
    () => workoutSetPr(workouts, workout, resets),
    [workouts, workout, resets],
  );
  return (
    <HudPanel title="Last Session" className="today__last">
      <div className="today__last-row">
        <span className="label label-hi">{LIFT_NAMES[workout.liftId]}</span>
        {effort && effort.actualReps !== undefined ? (
          <span className="today__last-amrap">
            <span className="num num-md">{fmtWeight(effort.weight)}</span>
            <span className="label text-mid">
              {workout.units.toUpperCase()} × {effort.actualReps}
            </span>
            {isPr && <PrBadge />}
          </span>
        ) : (
          <span className="label text-low">Logged</span>
        )}
      </div>
    </HudPanel>
  );
}

// ---------------------------------------------------------------------------
// StrongLifts branch
// ---------------------------------------------------------------------------

function SlToday({
  sl,
  workouts,
  allWorkouts,
  resets,
  onOpen,
  onComplete,
}: {
  sl: SlCycleState;
  workouts: Workout[];
  allWorkouts: Workout[];
  resets: readonly string[];
  /** Opens a session; the caller already knows the block's cycle id. */
  onOpen: (session: number) => void;
  onComplete: () => void;
}) {
  // ONE definition of "the session you may act on", shared with the session
  // screen and the cycle grid: the repo's sequential gate.
  const current = earliestUnresolvedSlSession(workouts);
  const lastSession = lastCompletedSlSession(workouts);

  return (
    <>
      {current === null ? (
        <BlockCompleteCard onGo={onComplete} />
      ) : (
        <SlNextSessionCard
          workouts={workouts}
          sl={sl}
          session={current}
          onStart={() => onOpen(current)}
        />
      )}

      {lastSession !== null && (
        <SlLastSessionSummary
          workouts={workouts}
          allWorkouts={allWorkouts}
          session={lastSession}
          sl={sl}
          resets={resets}
        />
      )}
    </>
  );
}

function SlNextSessionCard({
  workouts,
  sl,
  session,
  onStart,
}: {
  workouts: Workout[];
  sl: SlCycleState;
  session: number;
  onStart: () => void;
}) {
  const view = buildSlSessionView(workouts, session, sl);
  const resuming = view.status === 'in_progress';

  return (
    <HudPanel active className="today__hero">
      <p className="today__hero-meta label">{slSessionHeading(session, view.slot, view.week)}</p>
      <div className="today__sllifts">
        {view.lifts.map((lift) => (
          <div key={lift.liftId} className="today__sllift">
            <span className="label label-hi">{LIFT_NAMES[lift.liftId]}</span>
            <span className="today__sllift-load">
              <span className="num num-md text-amber">{fmtWeightOrDash(lift.weight)}</span>
              <span className="label text-mid">{lift.workout.units.toUpperCase()}</span>
              <span className="label text-low">
                {lift.sets.length}×{lift.sets[0]?.targetReps ?? 5}
              </span>
              {lift.basis === 'projected' && <span className="label sltag">Projected</span>}
            </span>
          </div>
        ))}
      </div>
      <Button variant="primary" block className="today__start" onClick={onStart}>
        {resuming ? 'Resume' : 'Start'}
      </Button>
    </HudPanel>
  );
}

function BlockCompleteCard({ onGo }: { onGo: () => void }) {
  return (
    <HudPanel active className="today__hero">
      <p className="today__hero-meta label text-cyan">Block Complete</p>
      <p className="today__complete-copy label text-mid">
        Block complete. Continue 5×5 or return to 5/3/1.
      </p>
      <Button variant="primary" block className="today__start" onClick={onGo}>
        Complete Cycle →
      </Button>
    </HudPanel>
  );
}

function SlLastSessionSummary({
  workouts,
  allWorkouts,
  session,
  sl,
  resets,
}: {
  workouts: Workout[];
  allWorkouts: Workout[];
  session: number;
  sl: SlCycleState;
  resets: readonly string[];
}) {
  const view = buildSlSessionView(workouts, session, sl);
  const rows = slSessionRows(workouts, session);
  const prIds = useMemo(() => {
    const ids = new Set<string>();
    for (const w of rows) {
      if (workoutSetPr(allWorkouts, w, resets)) ids.add(w.id);
    }
    return ids;
  }, [rows, allWorkouts, resets]);

  return (
    <HudPanel title={`Last Session · ${String(session).padStart(2, '0')} ${view.slot}`} className="today__last">
      {view.lifts.map((lift) => {
        const effort = effortSet(lift.workout);
        return (
          <div key={lift.liftId} className="today__last-row">
            <span className="label label-hi">{LIFT_NAMES[lift.liftId]}</span>
            <span className="today__last-amrap">
              <span className="num num-md">{fmtWeightOrDash(lift.weight)}</span>
              <span className="label text-mid">
                {lift.workout.units.toUpperCase()} ×{' '}
                {lift.sets.map((s) => s.actualReps ?? '—').join('/')}
              </span>
              {prIds.has(lift.workout.id) && <PrBadge />}
              {effort === null && <span className="label text-low">unlogged</span>}
            </span>
          </div>
        );
      })}
    </HudPanel>
  );
}

// ---------------------------------------------------------------------------
// Bodyweight
// ---------------------------------------------------------------------------

function BodyweightQuickLog({
  units,
  seed,
  onSaved,
  onError,
}: {
  units: Settings['units'];
  /** Already converted into `units` and rounded to the step (bodyweightSeed). */
  seed: number;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const step = bodyweightStep(units);
  const [value, setValue] = useState<number>(seed);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await upsertBodyweight(localIsoDate(), value, units);
      onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save bodyweight');
    } finally {
      setSaving(false);
    }
  };

  return (
    <HudPanel title="Bodyweight" className="today__bw">
      <p className="label text-low today__bw-date">{localIsoDate()}</p>
      <div className="today__bw-row">
        <NumberStepper
          value={value}
          onChange={setValue}
          step={step}
          min={0}
          decimals={units === 'lb' ? 0 : 1}
          suffix={units.toUpperCase()}
          label="Bodyweight"
        />
        <Button variant="ghost" onClick={save} disabled={saving}>
          Save
        </Button>
      </div>
    </HudPanel>
  );
}
