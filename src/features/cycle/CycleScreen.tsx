import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Cycle, LiftId, SlCycleState, SlLiftId, Settings, Workout } from '../../core/types.ts';
import { normalizeDayOrder } from '../../core/scheme.ts';
import { SL_LIFTS, SL_SESSIONS_PER_CYCLE } from '../../core/sl.ts';
import {
  addDeloadToActiveCycle,
  getActiveCycle,
  getCycleWorkouts,
  getSettings,
  getTrainingMaxes,
  listCycles,
  removeDeloadFromActiveCycle,
} from '../../db/repo/index.ts';
import { Button, HudPanel, useToast } from '../../components/index.ts';
import { cycleTag, LIFT_ABBR, LIFT_NAMES, slWeekLabel, weekLabel } from '../shared/liftLabels.ts';
import { fmtWeight } from '../shared/format.ts';
import { slStreakPips } from '../sl/slView.ts';
import { SlWeightOverrideModal } from '../sl/SlWeightOverrideModal.tsx';
import '../sl/sl.css';
import {
  allResolved,
  buildGrid,
  buildSlGrid,
  deloadRemovable,
  hasDeload,
  slAllResolved,
  type GridCell,
  type SlGridCell,
} from './cycleGrid.ts';
import { TmOverrideModal } from './TmOverrideModal.tsx';
import { CompleteCycleModal } from './CompleteCycleModal.tsx';
import './cycle.css';

interface CycleData {
  settings: Settings | null;
  cycle: Cycle | null;
  workouts: Workout[];
  tms: Partial<Record<LiftId, number>>;
  /** Every cycle — the switch-in setup carries the row weight forward from one. */
  cycles: Cycle[];
}

async function readCycle(): Promise<CycleData> {
  const settings = (await getSettings()) ?? null;
  const cycle = (await getActiveCycle()) ?? null;
  const workouts = cycle ? await getCycleWorkouts(cycle.id) : [];
  const tms = await getTrainingMaxes();
  const cycles = await listCycles();
  return { settings, cycle, workouts, tms, cycles };
}

export function CycleScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const data = useLiveQuery(() => readCycle(), []);

  const [overrideLift, setOverrideLift] = useState<LiftId | null>(null);
  const [overrideSlLift, setOverrideSlLift] = useState<SlLiftId | null>(null);
  const [completing, setCompleting] = useState(false);

  if (data === undefined) {
    return (
      <div className="cycle">
        <p className="label cycle__loading">Loading…</p>
      </div>
    );
  }

  const { settings, cycle, workouts, tms, cycles } = data;
  if (settings === null || cycle === null) {
    return (
      <div className="cycle">
        <p className="label cycle__loading">No active cycle.</p>
      </div>
    );
  }

  const sl = cycle.program === 'sl5x5' ? cycle.sl : undefined;
  const order = normalizeDayOrder(settings.dayOrder);
  const tmStep = settings.units === 'kg' ? 1.25 : 2.5;
  const weightStep = settings.roundingIncrement;
  // Snapshot TMs from the active cycle (authoritative for advance recommendation).
  const cycleTms = cycle.tms;
  const canComplete = sl ? slAllResolved(workouts) : allResolved(workouts);

  const onDeloadToggle = async () => {
    try {
      if (hasDeload(workouts)) {
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
          {sl
            ? `StrongLifts 5×5 · ${SL_SESSIONS_PER_CYCLE} sessions`
            : hasDeload(workouts)
              ? '4 weeks · deload'
              : '3 weeks'}
        </p>
      </header>

      {sl ? (
        <>
          <SlWeightStrip
            sl={sl}
            units={settings.units}
            onOpen={(liftId) => setOverrideSlLift(liftId)}
          />
          <HudPanel title="Sessions" className="cycle__grid-panel">
            <div className="cycle__grid" role="table" aria-label="StrongLifts session schedule">
              <div className="cycle__slgrid-row" role="row">
                <span className="cycle__grid-corner label" role="columnheader" />
                {['1', '2', '3'].map((n) => (
                  <span key={n} className="label cycle__grid-col" role="columnheader">
                    S{n}
                  </span>
                ))}
              </div>
              {buildSlGrid(workouts, sl).map((row) => (
                <div key={row.week} className="cycle__slgrid-row" role="row">
                  <span className="label cycle__grid-week" role="rowheader">
                    {row.week}
                  </span>
                  {row.cells.map((cell) => (
                    <SlCell
                      key={cell.session}
                      cell={cell}
                      units={settings.units}
                      onOpen={(session) => navigate(`/sl-session/${cycle.id}/${session}`)}
                    />
                  ))}
                </div>
              ))}
            </div>
            <p className="label text-low cycle__caption">
              Rows are weeks; each cell is a whole session at its squat load. Dimmed weights are
              projected — they assume every session before them is passed.
            </p>
          </HudPanel>
        </>
      ) : (
        <>
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
              {buildGrid(workouts, order).map((row) => (
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

          {/* Deload footer action — 5/3/1 only. A StrongLifts block's sessions
              10-12 carry week === 4, so a deload plan would treat them as the
              deload week and delete them; the repo throws, and the UI never
              offers the button in the first place. */}
          <div className="cycle__deload">
            {hasDeload(workouts) ? (
              <>
                <Button
                  variant="ghost"
                  block
                  onClick={onDeloadToggle}
                  disabled={!deloadRemovable(workouts)}
                >
                  Remove Deload Week
                </Button>
                {!deloadRemovable(workouts) && (
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
        </>
      )}

      {/* Complete cycle */}
      <div className="cycle__complete">
        <Button variant="primary" block onClick={() => setCompleting(true)} disabled={!canComplete}>
          Complete Cycle
        </Button>
        {!canComplete && (
          <p className="label text-low cycle__caption">
            {sl
              ? 'Enabled once all twelve sessions are completed or skipped.'
              : 'Enabled once every workout is completed or skipped.'}
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

      {overrideSlLift && sl && (
        <SlWeightOverrideModal
          cycleId={cycle.id}
          liftId={overrideSlLift}
          runtime={sl.lifts[overrideSlLift]}
          units={settings.units}
          step={weightStep}
          workouts={workouts}
          onClose={() => setOverrideSlLift(null)}
        />
      )}

      {completing && (
        <CompleteCycleModal
          cycle={cycle}
          cycles={cycles}
          workouts={workouts}
          settings={settings}
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

// ---------------------------------------------------------------------------
// StrongLifts pieces
// ---------------------------------------------------------------------------

/**
 * The five working weights, in {@link SL_LIFTS} order (SQ / B / R / P / DL),
 * each with its fail-streak pips. Tapping one opens the override modal — this
 * strip is to a block what the TM strip is to a 5/3/1 cycle.
 */
function SlWeightStrip({
  sl,
  units,
  onOpen,
}: {
  sl: SlCycleState;
  units: Settings['units'];
  onOpen: (liftId: SlLiftId) => void;
}) {
  return (
    <section className="slstrip">
      {SL_LIFTS.map((liftId) => {
        const runtime = sl.lifts[liftId];
        return (
          <button
            key={liftId}
            type="button"
            className="slcell"
            onClick={() => onOpen(liftId)}
            aria-label={`${LIFT_NAMES[liftId]} working weight ${fmtWeight(runtime.weight)} ${units.toUpperCase()}, ${runtime.failStreak} of 3 misses`}
          >
            <span className="label slcell__lift">{LIFT_ABBR[liftId]}</span>
            <span className="num slcell__w">{fmtWeight(runtime.weight)}</span>
            <span className="label tmcell__unit text-low">{units.toUpperCase()}</span>
            <span className="slcell__pips" aria-hidden="true">
              {slStreakPips(runtime.failStreak).map((on, i) => (
                <span key={i} className={`slpip${on ? ' is-on' : ''}`} />
              ))}
            </span>
          </button>
        );
      })}
    </section>
  );
}

function SlCell({
  cell,
  units,
  onOpen,
}: {
  cell: SlGridCell;
  units: Settings['units'];
  onOpen: (session: number) => void;
}) {
  const glyphStatus = cell.status === 'mixed' ? 'pending' : cell.status;
  return (
    <button
      type="button"
      className={`slgridcell slgridcell--${cell.status}`}
      onClick={() => onOpen(cell.session)}
      aria-label={`${slWeekLabel(cell.workouts[0]?.week ?? 1)} session ${cell.session} ${cell.slot} — ${cell.status}`}
    >
      <span className={`glyph glyph--${glyphStatus}`} aria-hidden="true" />
      <span className="label slgridcell__tag">
        {String(cell.session).padStart(2, '0')} {cell.slot}
      </span>
      <span className={`num slgridcell__w${cell.basis === 'projected' ? ' is-projected' : ''}`}>
        {cell.squatWeight !== null ? fmtWeight(cell.squatWeight) : '—'}
      </span>
      <span className="label cyclecell__unit text-low">{units.toUpperCase()}</span>
    </button>
  );
}
