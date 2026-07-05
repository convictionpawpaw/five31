import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Cycle, LiftId, Workout } from '../../core/types.ts';
import { DAY_ORDER } from '../../core/scheme.ts';
import { db } from '../../db/db.ts';
import { listCycles } from '../../db/repo/index.ts';
import { EmptyState, PrBadge } from '../../components/index.ts';
import { LIFT_NAMES, weekLabel } from '../shared/liftLabels.ts';
import { fmtMonthYear, fmtShortDate, fmtWeight } from '../shared/format.ts';
import { amrapSet } from '../shared/workoutSelect.ts';
import { groupHistoryByCycle, type HistoryGroup, type HistoryRow } from './historyGrouping.ts';
import './history.css';

interface HistoryData {
  cycles: Cycle[];
  workouts: Workout[];
}

async function readHistory(): Promise<HistoryData> {
  const [cycles, workouts] = await Promise.all([listCycles(), db.workouts.toArray()]);
  return { cycles, workouts };
}

export function HistoryScreen() {
  const data = useLiveQuery(() => readHistory(), []);
  const groups = useMemo(
    () => (data ? groupHistoryByCycle(data.cycles, data.workouts) : []),
    [data],
  );

  if (data === undefined) {
    return (
      <div className="history">
        <p className="label history__loading">Loading…</p>
      </div>
    );
  }

  return (
    <div className="history safe-top">
      <header className="history__head">
        <h1 className="history__title num">History</h1>
      </header>

      {groups.length === 0 ? (
        <EmptyState title="No history yet" message="Completed and skipped workouts appear here." />
      ) : (
        groups.map((group, i) => <CycleGroup key={group.cycle.id} group={group} defaultOpen={i === 0} />)
      )}
    </div>
  );
}

/** "TMs 125/285/210/265" in DAY_ORDER for a cycle header. */
function tmSummary(tms: Record<LiftId, number>): string {
  return DAY_ORDER.map((liftId) => fmtWeight(tms[liftId])).join('/');
}

function CycleGroup({ group, defaultOpen }: { group: HistoryGroup; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const { cycle } = group;
  const cycleNo = String(cycle.number).padStart(2, '0');

  return (
    <section className="histgroup">
      <button
        type="button"
        className="histgroup__head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="label histgroup__title">
          Cycle {cycleNo} · {fmtMonthYear(cycle.startedAt)}
        </span>
        <span className="label text-low histgroup__tms">
          TMs {tmSummary(cycle.tms)} {cycle.units.toUpperCase()}
        </span>
        <span className="label text-low histgroup__chev" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      {open && (
        <ul className="histgroup__rows">
          {group.rows.map((row) => (
            <HistoryRowItem key={row.workout.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

function HistoryRowItem({ row }: { row: HistoryRow }) {
  const navigate = useNavigate();
  const { workout } = row;
  const skipped = workout.status === 'skipped';
  const set = amrapSet(workout);
  const dateStr = fmtShortDate(workout.completedAt ?? workout.startedAt ?? workout.id);

  return (
    <li>
      <button
        type="button"
        className={`histrow${skipped ? ' histrow--skipped' : ''}`}
        onClick={() => navigate(`/history/${workout.id}`)}
      >
        <span className="histrow__date label text-low">{dateStr}</span>
        <span className="histrow__lift label label-hi">
          {LIFT_NAMES[workout.liftId]}
          <span className="histrow__week text-low"> · {weekLabel(workout.week)}</span>
        </span>
        <span className="histrow__result">
          {skipped ? (
            <span className="label text-low">SKIPPED</span>
          ) : set && set.actualReps !== undefined ? (
            <span className="num histrow__amrap">
              {fmtWeight(set.weight)}
              <span className="text-low"> × </span>
              {set.actualReps}
            </span>
          ) : (
            <span className="label text-low">LOGGED</span>
          )}
          {row.isPr && <PrBadge />}
          {workout.editedAt !== undefined && <span className="label histrow__edited">edited</span>}
        </span>
      </button>
    </li>
  );
}
