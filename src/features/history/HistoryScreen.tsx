import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Cycle, LiftId, Settings, Workout } from '../../core/types.ts';
import { normalizeDayOrder } from '../../core/scheme.ts';
import { effortSet } from '../../core/efforts.ts';
import { db } from '../../db/db.ts';
import { getSettings, listCycles } from '../../db/repo/index.ts';
import { EmptyState, PrBadge } from '../../components/index.ts';
import { LIFT_NAMES, sessionLabel, weekLabel } from '../shared/liftLabels.ts';
import { fmtMonthYear, fmtShortDate, fmtWeight } from '../shared/format.ts';
import {
  clusterSlRowsBySession,
  groupHistoryByCycle,
  isSlCycle,
  type HistoryGroup,
  type HistoryRow,
  type SlHistoryCluster,
} from './historyGrouping.ts';
import './history.css';

interface HistoryData {
  settings: Settings | null;
  cycles: Cycle[];
  workouts: Workout[];
}

async function readHistory(): Promise<HistoryData> {
  const [settings, cycles, workouts] = await Promise.all([
    getSettings(),
    listCycles(),
    db.workouts.toArray(),
  ]);
  return { settings: settings ?? null, cycles, workouts };
}

export function HistoryScreen() {
  const data = useLiveQuery(() => readHistory(), []);
  const groups = useMemo(
    () => (data ? groupHistoryByCycle(data.cycles, data.workouts, data.settings?.prResets ?? []) : []),
    [data],
  );
  const order = useMemo(() => normalizeDayOrder(data?.settings?.dayOrder), [data?.settings?.dayOrder]);

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
        groups.map((group, i) => (
          <CycleGroup key={group.cycle.id} group={group} defaultOpen={i === 0} order={order} />
        ))
      )}
    </div>
  );
}

/** "TMs 125/285/210/265" in the user's day order for a cycle header. */
function tmSummary(tms: Record<LiftId, number>, order: readonly LiftId[]): string {
  return order.map((liftId) => fmtWeight(tms[liftId])).join('/');
}

function CycleGroup({
  group,
  defaultOpen,
  order,
}: {
  group: HistoryGroup;
  defaultOpen: boolean;
  order: readonly LiftId[];
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { cycle } = group;
  const cycleNo = String(cycle.number).padStart(2, '0');
  const isSl = isSlCycle(cycle);
  // A block's TMs are a DORMANT snapshot, not what was trained — showing them
  // would be a lie about the session weights below, so the tag replaces them.
  const clusters = isSl ? clusterSlRowsBySession(group.rows) : [];

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
          {isSl ? 'StrongLifts 5×5' : `TMs ${tmSummary(cycle.tms, order)} ${cycle.units.toUpperCase()}`}
        </span>
        <span className="label text-low histgroup__chev" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      {open &&
        (isSl ? (
          <div className="histgroup__sessions">
            {clusters.map((cluster) => (
              <SlSessionCluster key={cluster.session} cluster={cluster} />
            ))}
          </div>
        ) : (
          <ul className="histgroup__rows">
            {group.rows.map((row) => (
              <HistoryRowItem key={row.workout.id} row={row} />
            ))}
          </ul>
        ))}
    </section>
  );
}

function HistoryRowItem({ row }: { row: HistoryRow }) {
  const navigate = useNavigate();
  const { workout } = row;
  const skipped = workout.status === 'skipped';
  const set = effortSet(workout);
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

/**
 * One StrongLifts session: a header line (`S05 · A · JUL 12`) with the three
 * lift sub-rows beneath it. Flat per-lift rows would be unreadable here — a
 * squat row means nothing without the session it was trained in.
 */
function SlSessionCluster({ cluster }: { cluster: SlHistoryCluster }) {
  const navigate = useNavigate();
  return (
    <div className={`histsession${cluster.skipped ? ' histsession--skipped' : ''}`}>
      <div className="histsession__head label text-low">
        {sessionLabel(cluster.session, cluster.slot)} · {fmtShortDate(cluster.dateKey)}
        {cluster.skipped && <span className="histsession__skip label"> SKIPPED</span>}
      </div>
      <ul className="histsession__rows">
        {cluster.rows.map((row) => {
          const set = effortSet(row.workout);
          const work = row.workout.mainSets.filter((s) => s.kind === 'work');
          return (
            <li key={row.workout.id}>
              <button
                type="button"
                className="histsubrow"
                onClick={() => navigate(`/history/${row.workout.id}`)}
              >
                <span className="label label-hi histsubrow__lift">
                  {LIFT_NAMES[row.workout.liftId]}
                </span>
                <span className="histsubrow__result">
                  {cluster.skipped || work.length === 0 ? (
                    <span className="label text-low">—</span>
                  ) : (
                    <span className="num histsubrow__sets">
                      {fmtWeight(set?.weight ?? work[0]!.weight)}
                      <span className="text-low"> × </span>
                      {work.map((s) => s.actualReps ?? '—').join('/')}
                    </span>
                  )}
                  {row.isPr && <PrBadge />}
                  {row.workout.editedAt !== undefined && (
                    <span className="label histrow__edited">edited</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
