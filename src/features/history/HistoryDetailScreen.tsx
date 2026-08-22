import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { MainSet, Workout } from '../../core/types.ts';
import { db } from '../../db/db.ts';
import { editPastWorkout, type PastWorkoutEdits } from '../../db/repo/index.ts';
import { Button, HudPanel, NumberStepper, useToast } from '../../components/index.ts';
import { cycleTag, LIFT_NAMES, sessionLabel, slWeekLabel, weekLabel } from '../shared/liftLabels.ts';
import { fmtTargetReps, fmtWeight } from '../shared/format.ts';
import './historyDetail.css';

export function HistoryDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // Wrap in an envelope so "loading" (undefined) is distinct from "not found" (null).
  const result = useLiveQuery(
    async () => ({ workout: (id ? await db.workouts.get(id) : undefined) ?? null }),
    [id],
  );

  if (result === undefined) {
    return (
      <div className="hdetail">
        <p className="label hdetail__loading">Loading…</p>
      </div>
    );
  }
  const workout = result.workout;
  if (workout === null) {
    return (
      <div className="hdetail">
        <p className="label hdetail__loading">Workout not found.</p>
        <Button variant="ghost" onClick={() => navigate('/history')}>
          Back to History
        </Button>
      </div>
    );
  }

  // Pending / in_progress workouts aren't editable here — send to the logger.
  const resolved = workout.status === 'completed' || workout.status === 'skipped';
  if (!resolved) {
    return (
      <div className="hdetail safe-top">
        <DetailHeader workout={workout} />
        <HudPanel title={workout.status === 'in_progress' ? 'In progress' : 'Pending'}>
          <p className="label text-mid hdetail__note">
            This workout isn&apos;t finished. Continue logging it from the workout screen.
          </p>
          <Button variant="primary" block onClick={() => navigate(`/workout/${workout.id}`)}>
            Open Workout
          </Button>
        </HudPanel>
      </div>
    );
  }

  return <ResolvedDetail workout={workout} />;
}

function DetailHeader({ workout }: { workout: Workout }) {
  // A StrongLifts row has no training max: `tmUsed` holds the session's WORKING
  // weight, so it is labelled as such. Its week is an ordinary fourth week too,
  // never a deload — hence slWeekLabel rather than weekLabel.
  const isSl = workout.program === 'sl5x5' && workout.session !== undefined && workout.slSlot !== undefined;
  return (
    <header className="hdetail__head">
      <h1 className="hdetail__lift num">{LIFT_NAMES[workout.liftId]}</h1>
      <p className="label hdetail__meta">
        Cycle {cycleTag(workout.cycleNumber)} ·{' '}
        {isSl
          ? `${sessionLabel(workout.session!, workout.slSlot!)} · ${slWeekLabel(workout.week)}`
          : weekLabel(workout.week)}
      </p>
      <p className="label text-mid">
        {isSl ? 'WORK' : 'TM'} {fmtWeight(workout.tmUsed)} {workout.units.toUpperCase()}
      </p>
    </header>
  );
}

function ResolvedDetail({ workout }: { workout: Workout }) {
  const toast = useToast();
  const skipped = workout.status === 'skipped';

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Local editable state, seeded from the workout. Reset whenever entering edit.
  const [mainReps, setMainReps] = useState<Record<string, number | undefined>>({});
  const [accReps, setAccReps] = useState<Record<string, number | null>>({});
  const [notes, setNotes] = useState(workout.notes ?? '');

  const workSets = useMemo(() => workout.mainSets.filter((s) => s.kind === 'work'), [workout]);
  const warmups = useMemo(() => workout.mainSets.filter((s) => s.kind === 'warmup'), [workout]);

  const beginEdit = () => {
    const m: Record<string, number | undefined> = {};
    for (const s of workout.mainSets) m[`${s.kind}-${s.index}`] = s.actualReps;
    const a: Record<string, number | null> = {};
    workout.accessoryWork.forEach((acc, ai) => {
      acc.setReps.forEach((r, si) => {
        a[`${ai}-${si}`] = r;
      });
    });
    setMainReps(m);
    setAccReps(a);
    setNotes(workout.notes ?? '');
    setEditing(true);
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const edits: PastWorkoutEdits = {};

      const mainSetReps: NonNullable<PastWorkoutEdits['mainSetReps']> = [];
      for (const s of workout.mainSets) {
        const key = `${s.kind}-${s.index}`;
        const next = mainReps[key];
        if (next !== undefined && next !== s.actualReps) {
          mainSetReps.push({ kind: s.kind, index: s.index, actualReps: next });
        }
      }
      if (mainSetReps.length > 0) edits.mainSetReps = mainSetReps;

      const accessorySetReps: NonNullable<PastWorkoutEdits['accessorySetReps']> = [];
      workout.accessoryWork.forEach((acc, ai) => {
        acc.setReps.forEach((r, si) => {
          const next = accReps[`${ai}-${si}`];
          if (next !== undefined && next !== null && next !== r) {
            accessorySetReps.push({ accessoryIndex: ai, setIndex: si, reps: next });
          }
        });
      });
      if (accessorySetReps.length > 0) edits.accessorySetReps = accessorySetReps;

      if (notes !== (workout.notes ?? '')) edits.notes = notes;

      const changed =
        edits.mainSetReps !== undefined ||
        edits.accessorySetReps !== undefined ||
        edits.notes !== undefined;

      if (changed) {
        await editPastWorkout(workout.id, edits);
        toast.show('Workout updated', 'success');
      }
      setEditing(false);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Save failed', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hdetail safe-top">
      <DetailHeader workout={workout} />

      {skipped ? (
        <HudPanel title="Skipped">
          <p className="label text-mid hdetail__note">This workout was skipped.</p>
        </HudPanel>
      ) : (
        <>
          <div className="hdetail__toolbar">
            <span className="label text-low">{editing ? 'Editing' : 'Read only'}</span>
            {editing ? (
              <div className="hdetail__toolbar-actions">
                <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => void save()} disabled={busy}>
                  Save
                </Button>
              </div>
            ) : (
              <Button variant="ghost" onClick={beginEdit}>
                Edit
              </Button>
            )}
          </div>

          {warmups.length > 0 && (
            <HudPanel title="Warmups">
              <SetTable
                sets={warmups}
                units={workout.units}
                editing={editing}
                reps={mainReps}
                onChange={(key, v) => setMainReps((p) => ({ ...p, [key]: v }))}
              />
            </HudPanel>
          )}

          <HudPanel title="Work Sets">
            <SetTable
              sets={workSets}
              units={workout.units}
              editing={editing}
              reps={mainReps}
              onChange={(key, v) => setMainReps((p) => ({ ...p, [key]: v }))}
            />
          </HudPanel>

          {workout.accessoryWork.length > 0 && (
            <HudPanel title="Accessories">
              <div className="hdetail__acc-list">
                {workout.accessoryWork.map((acc, ai) => (
                  <div key={acc.accessoryId} className="hdetail__acc">
                    <div className="hdetail__acc-head">
                      <span className="label label-hi">{acc.name}</span>
                      <span className="label text-mid">
                        {acc.repRangeMin}-{acc.repRangeMax} @ {fmtWeight(acc.weight)}{' '}
                        {workout.units.toUpperCase()}
                      </span>
                    </div>
                    <div className="hdetail__acc-sets">
                      {acc.setReps.map((r, si) => {
                        const key = `${ai}-${si}`;
                        if (editing) {
                          return (
                            <div key={si} className="hdetail__acc-edit">
                              <span className="label text-low">Set {si + 1}</span>
                              <NumberStepper
                                value={accReps[key] ?? acc.repRangeMax}
                                onChange={(v) => setAccReps((p) => ({ ...p, [key]: v }))}
                                step={1}
                                min={0}
                                label={`${acc.name} set ${si + 1} reps`}
                              />
                            </div>
                          );
                        }
                        return (
                          <span key={si} className="hdetail__acc-chip num">
                            {r ?? '·'}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </HudPanel>
          )}

          <HudPanel title="Notes">
            {editing ? (
              <textarea
                className="hdetail__notes"
                value={notes}
                placeholder="Notes"
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            ) : (
              <p className="label text-mid hdetail__notes-ro">
                {workout.notes && workout.notes.length > 0 ? workout.notes : 'No notes.'}
              </p>
            )}
          </HudPanel>

          <p className="label text-low hdetail__caption">
            Editing history never changes training maxes or accessory weights.
          </p>
        </>
      )}
    </div>
  );
}

function SetTable({
  sets,
  units,
  editing,
  reps,
  onChange,
}: {
  sets: MainSet[];
  units: Workout['units'];
  editing: boolean;
  reps: Record<string, number | undefined>;
  onChange: (key: string, value: number) => void;
}) {
  return (
    <div className="settable">
      {sets.map((s) => {
        const key = `${s.kind}-${s.index}`;
        return (
          <div key={key} className="settable__row">
            <span className="settable__weight num">
              {fmtWeight(s.weight)}
              <span className="label text-mid"> {units.toUpperCase()}</span>
            </span>
            <span className="settable__target label text-low">
              target {fmtTargetReps(s.targetReps, s.amrap)}
            </span>
            {editing ? (
              <NumberStepper
                value={reps[key] ?? s.actualReps ?? s.targetReps}
                onChange={(v) => onChange(key, v)}
                step={1}
                min={0}
                label={`${s.kind} set reps`}
              />
            ) : (
              <span className="settable__actual num">
                {s.actualReps ?? '—'}
                {s.amrap ? '+' : ''}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
