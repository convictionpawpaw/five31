import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Settings, Workout } from '../../core/types.ts';
import {
  getActiveCycle,
  getCycleWorkouts,
  getSettings,
  listBodyweight,
  upsertBodyweight,
} from '../../db/repo/index.ts';
import { Button, HudPanel, NumberStepper, PrBadge, useToast } from '../../components/index.ts';
import { cycleTag, LIFT_NAMES, weekLabel } from '../shared/liftLabels.ts';
import { fmtTargetReps, fmtWeight } from '../shared/format.ts';
import {
  isCycleResolved,
  lastCompletedWorkout,
  selectNextWorkout,
  topWorkSet,
} from '../shared/workoutSelect.ts';
import { workoutSetPr } from '../workout/workoutHelpers.ts';
import './today.css';

interface TodayData {
  settings: Settings | null;
  cycleNumber: number | null;
  workouts: Workout[];
  lastBodyweight: number | null;
}

async function readToday(): Promise<TodayData> {
  const settings = (await getSettings()) ?? null;
  const cycle = await getActiveCycle();
  const workouts = cycle ? await getCycleWorkouts(cycle.id) : [];
  const bw = await listBodyweight();
  const lastBodyweight = bw.length > 0 ? bw[bw.length - 1]!.weight : null;
  return {
    settings,
    cycleNumber: cycle?.number ?? null,
    workouts,
    lastBodyweight,
  };
}

/** Today's calendar date as an ISO date string (local), e.g. '2026-07-05'. */
function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

  const { settings, cycleNumber, workouts, lastBodyweight } = data;
  if (settings === null || cycleNumber === null) {
    return (
      <div className="today">
        <p className="label today__loading">No active cycle.</p>
      </div>
    );
  }

  const next = selectNextWorkout(workouts);
  const resolved = isCycleResolved(workouts);
  const last = lastCompletedWorkout(workouts);

  return (
    <div className="today safe-top">
      <header className="today__head">
        <h1 className="today__brand num">FIVE31</h1>
        <p className="today__sub label">Cycle {cycleTag(cycleNumber)}</p>
      </header>

      {resolved ? (
        <CycleCompleteCard onGo={() => navigate('/cycle')} />
      ) : next ? (
        <NextWorkoutCard
          workout={next}
          cycleNumber={cycleNumber}
          onStart={() => navigate(`/workout/${next.id}`)}
        />
      ) : (
        <HudPanel title="Today">
          <p className="label text-mid">No workouts in this cycle.</p>
        </HudPanel>
      )}

      {last && <LastWorkoutSummary workout={last} workouts={workouts} />}

      <BodyweightQuickLog
        units={settings.units}
        seed={lastBodyweight}
        onSaved={() => toast.show('Bodyweight saved', 'success')}
      />
    </div>
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

function LastWorkoutSummary({ workout, workouts }: { workout: Workout; workouts: Workout[] }) {
  const amrap = workout.mainSets.find((s) => s.kind === 'work' && s.amrap);
  const isPr = useMemo(() => workoutSetPr(workouts, workout), [workouts, workout]);
  return (
    <HudPanel title="Last Session" className="today__last">
      <div className="today__last-row">
        <span className="label label-hi">{LIFT_NAMES[workout.liftId]}</span>
        {amrap && amrap.actualReps !== undefined ? (
          <span className="today__last-amrap">
            <span className="num num-md">{fmtWeight(amrap.weight)}</span>
            <span className="label text-mid">
              {workout.units.toUpperCase()} × {amrap.actualReps}
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

function BodyweightQuickLog({
  units,
  seed,
  onSaved,
}: {
  units: Settings['units'];
  seed: number | null;
  onSaved: () => void;
}) {
  const step = units === 'lb' ? 1 : 0.5;
  const [value, setValue] = useState<number>(seed ?? (units === 'lb' ? 180 : 82));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await upsertBodyweight(todayIso(), value, units);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <HudPanel title="Bodyweight" className="today__bw">
      <p className="label text-low today__bw-date">{todayIso()}</p>
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
