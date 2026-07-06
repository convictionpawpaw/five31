import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Cycle, LiftId, Settings, Workout } from '../../core/types.ts';
import { normalizeDayOrder } from '../../core/scheme.ts';
import {
  addDeloadToActiveCycle,
  getActiveCycle,
  getCycleWorkouts,
  getSettings,
  getTrainingMaxes,
  removeDeloadFromActiveCycle,
} from '../../db/repo/index.ts';
import { Button, HudPanel, useToast } from '../../components/index.ts';
import { cycleTag, LIFT_ABBR, LIFT_NAMES, weekLabel } from '../shared/liftLabels.ts';
import { fmtWeight } from '../shared/format.ts';
import {
  allResolved,
  buildGrid,
  deloadRemovable,
  hasDeload,
  type GridCell,
} from './cycleGrid.ts';
import { TmOverrideModal } from './TmOverrideModal.tsx';
import { CompleteCycleModal } from './CompleteCycleModal.tsx';
import './cycle.css';

interface CycleData {
  settings: Settings | null;
  cycle: Cycle | null;
  workouts: Workout[];
  tms: Partial<Record<LiftId, number>>;
}

async function readCycle(): Promise<CycleData> {
  const settings = (await getSettings()) ?? null;
  const cycle = (await getActiveCycle()) ?? null;
  const workouts = cycle ? await getCycleWorkouts(cycle.id) : [];
  const tms = await getTrainingMaxes();
  return { settings, cycle, workouts, tms };
}

export function CycleScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const data = useLiveQuery(() => readCycle(), []);

  const [overrideLift, setOverrideLift] = useState<LiftId | null>(null);
  const [completing, setCompleting] = useState(false);

  if (data === undefined) {
    return (
      <div className="cycle">
        <p className="label cycle__loading">Loading…</p>
      </div>
    );
  }

  const { settings, cycle, workouts, tms } = data;
  if (settings === null || cycle === null) {
    return (
      <div className="cycle">
        <p className="label cycle__loading">No active cycle.</p>
      </div>
    );
  }

  const order = normalizeDayOrder(settings.dayOrder);
  const grid = buildGrid(workouts, order);
  const canComplete = allResolved(workouts);
  const withDeload = hasDeload(workouts);
  const canRemoveDeload = deloadRemovable(workouts);
  const tmStep = settings.units === 'kg' ? 1.25 : 2.5;
  // Snapshot TMs from the active cycle (authoritative for advance recommendation).
  const cycleTms = cycle.tms;

  const onDeloadToggle = async () => {
    try {
      if (withDeload) {
        await removeDeloadFromActiveCycle();
        toast.show('Deload week removed', 'info');
      } else {
        await addDeloadToActiveCycle();
        toast.show('Deload week added', 'info');
      }
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Deload change failed', 'danger');
    }
  };

  return (
    <div className="cycle safe-top">
      <header className="cycle__head">
        <h1 className="cycle__title num">Cycle {cycleTag(cycle.number)}</h1>
        <p className="cycle__sub label text-mid">
          {withDeload ? '4 weeks · deload' : '3 weeks'}
        </p>
      </header>

      {/* TM strip */}
      <section className="cycle__tmstrip">
        {order.map((liftId) => (
          <button
            key={liftId}
            type="button"
            className="tmcell"
            onClick={() => setOverrideLift(liftId)}
          >
            <span className="label tmcell__lift">{LIFT_ABBR[liftId]}</span>
            <span className="num tmcell__tm">
              {tms[liftId] !== undefined ? fmtWeight(tms[liftId]!) : '—'}
            </span>
            <span className="label tmcell__unit text-low">{settings.units.toUpperCase()}</span>
          </button>
        ))}
      </section>

      {/* Week × lift grid */}
      <HudPanel title="Schedule" className="cycle__grid-panel">
        <div className="cycle__grid" role="table" aria-label="Cycle schedule">
          <div className="cycle__grid-header" role="row">
            <span className="cycle__grid-corner label" role="columnheader" />
            {order.map((liftId) => (
              <span key={liftId} className="label cycle__grid-col" role="columnheader">
                {LIFT_ABBR[liftId]}
              </span>
            ))}
          </div>
          {grid.map((row) => (
            <div key={row.week} className="cycle__grid-row" role="row">
              <span className="label cycle__grid-week" role="rowheader">
                {row.week === 4 ? 'DE' : row.week}
              </span>
              {row.cells.map((cell) => (
                <Cell
                  key={cell.liftId}
                  cell={cell}
                  units={settings.units}
                  onOpen={(id) => navigate(`/workout/${id}`)}
                />
              ))}
            </div>
          ))}
        </div>
      </HudPanel>

      {/* Deload footer action */}
      <div className="cycle__deload">
        {withDeload ? (
          <>
            <Button variant="ghost" block onClick={onDeloadToggle} disabled={!canRemoveDeload}>
              Remove Deload Week
            </Button>
            {!canRemoveDeload && (
              <p className="label text-low cycle__caption">
                Deload can only be removed while all four deload workouts are pending.
              </p>
            )}
          </>
        ) : (
          <Button variant="ghost" block onClick={onDeloadToggle}>
            Add Deload Week
          </Button>
        )}
      </div>

      {/* Complete cycle */}
      <div className="cycle__complete">
        <Button variant="primary" block onClick={() => setCompleting(true)} disabled={!canComplete}>
          Complete Cycle
        </Button>
        {!canComplete && (
          <p className="label text-low cycle__caption">
            Enabled once every workout is completed or skipped.
          </p>
        )}
      </div>

      {overrideLift && (
        <TmOverrideModal
          liftId={overrideLift}
          currentTm={cycleTms[overrideLift]}
          units={settings.units}
          step={tmStep}
          onClose={() => setOverrideLift(null)}
        />
      )}

      {completing && (
        <CompleteCycleModal
          workouts={workouts}
          settings={settings}
          currentTms={cycleTms}
          cycleNumber={cycle.number}
          onClose={() => setCompleting(false)}
          onDone={() => {
            setCompleting(false);
            navigate('/');
          }}
        />
      )}
    </div>
  );
}

function Cell({
  cell,
  units,
  onOpen,
}: {
  cell: GridCell;
  units: Settings['units'];
  onOpen: (id: string) => void;
}) {
  if (cell.workout === null) {
    return <span className="cyclecell cyclecell--empty" aria-hidden="true" />;
  }
  const status = cell.status ?? 'pending';
  return (
    <button
      type="button"
      className={`cyclecell cyclecell--${status}`}
      onClick={() => onOpen(cell.workout!.id)}
      aria-label={`${weekLabel(cell.workout.week)} ${LIFT_NAMES[cell.liftId]} — ${status}`}
    >
      <span className={`glyph glyph--${status}`} aria-hidden="true" />
      <span className="num cyclecell__w">
        {cell.topWeight !== null ? fmtWeight(cell.topWeight) : '—'}
      </span>
      <span className="label cyclecell__unit text-low">{units.toUpperCase()}</span>
    </button>
  );
}
