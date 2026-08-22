import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type {
  AccessoryDef,
  BodyweightEntry,
  Cycle,
  LiftId,
  SlLiftId,
  Settings,
  TmEvent,
  Workout,
} from '../../core/types.ts';
import { normalizeDayOrder } from '../../core/scheme.ts';
import { db } from '../../db/db.ts';
import {
  getSettings,
  listAllTmEvents,
  listBodyweight,
  listCycles,
} from '../../db/repo/index.ts';
import { EmptyState, HudPanel, PrBadge } from '../../components/index.ts';
import { LIFT_ABBR, LIFT_NAMES } from '../shared/liftLabels.ts';
import { fmtShortDate, fmtWeight } from '../shared/format.ts';
import { LineChart, StepChart } from './charts/index.ts';
import {
  accessoryOptions,
  buildAccessorySeries,
  buildBodyweightSeries,
  buildE1rmSeries,
  buildPrList,
  buildTmStepSeries,
  e1rmLiftChips,
  prResetCaption,
  type StatValue,
} from './progressData.ts';
import './progress.css';

type Tab = 'e1rm' | 'tm' | 'accessories' | 'bodyweight' | 'prs';

const TABS: { id: Tab; label: string }[] = [
  { id: 'e1rm', label: 'e1RM' },
  { id: 'tm', label: 'TM' },
  { id: 'accessories', label: 'Acc' },
  { id: 'bodyweight', label: 'BW' },
  { id: 'prs', label: 'PRs' },
];

interface ProgressData {
  settings: Settings | null;
  workouts: Workout[];
  cycles: Cycle[];
  accessories: AccessoryDef[];
  bodyweight: BodyweightEntry[];
  tmEvents: TmEvent[];
}

async function readProgress(): Promise<ProgressData> {
  const settings = (await getSettings()) ?? null;
  const [workouts, cycles, accessories, bodyweight, tmEvents] = await Promise.all([
    db.workouts.toArray(),
    listCycles(),
    db.accessories.toArray(),
    listBodyweight(),
    listAllTmEvents(),
  ]);
  return { settings, workouts, cycles, accessories, bodyweight, tmEvents };
}

export function ProgressScreen() {
  const data = useLiveQuery(() => readProgress(), []);
  const [tab, setTab] = useState<Tab>('e1rm');

  if (data === undefined) {
    return (
      <div className="progress">
        <p className="label progress__loading">Loading…</p>
      </div>
    );
  }
  if (data.settings === null) {
    return (
      <div className="progress">
        <p className="label progress__loading">No data yet.</p>
      </div>
    );
  }

  const { settings } = data;
  const order = normalizeDayOrder(settings.dayOrder);

  return (
    <div className="progress safe-top">
      <header className="progress__head">
        <h1 className="progress__title num">Progress</h1>
      </header>

      <div className="segmented" role="tablist" aria-label="Progress views">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`segmented__seg${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'e1rm' && (
        <E1rmTab
          workouts={data.workouts}
          units={settings.units}
          order={order}
          resets={settings.prResets ?? []}
        />
      )}
      {tab === 'tm' && (
        <TmTab cycles={data.cycles} tmEvents={data.tmEvents} units={settings.units} order={order} />
      )}
      {tab === 'accessories' && (
        <AccessoriesTab
          workouts={data.workouts}
          accessories={data.accessories}
          units={settings.units}
        />
      )}
      {tab === 'bodyweight' && (
        <BodyweightTab entries={data.bodyweight} units={settings.units} />
      )}
      {tab === 'prs' && <PrsTab workouts={data.workouts} resets={settings.prResets ?? []} />}
    </div>
  );
}

/** Big numeral stat readout, e.g. "LATEST 233 LB". */
function Stat({ label, stat }: { label: string; stat: StatValue | null }) {
  return (
    <div className="progress__stat">
      <span className="label progress__stat-label">{label}</span>
      {stat ? (
        <span className="progress__stat-value">
          <span className="num num-lg text-amber">{fmtWeight(stat.value)}</span>
          <span className="label text-mid">{stat.units.toUpperCase()}</span>
        </span>
      ) : (
        <span className="num num-lg text-low">—</span>
      )}
    </div>
  );
}

/**
 * Lift chips, generic over {@link SlLiftId} so the e1RM tab can append ROW while
 * the TM tab stays strictly 4-lift (training maxes are a 5/3/1 concept and the
 * row has none).
 */
function LiftChips<T extends SlLiftId>({
  value,
  onChange,
  order,
}: {
  value: T;
  onChange: (l: T) => void;
  order: readonly T[];
}) {
  return (
    <div className="progress__chips" role="tablist" aria-label="Lift">
      {order.map((liftId) => (
        <button
          key={liftId}
          type="button"
          role="tab"
          aria-selected={value === liftId}
          className={`chip${value === liftId ? ' is-active' : ''}`}
          onClick={() => onChange(liftId)}
        >
          {LIFT_ABBR[liftId]}
        </button>
      ))}
    </div>
  );
}

// --- e1RM tab --------------------------------------------------------------

function E1rmTab({
  workouts,
  units,
  order,
  resets,
}: {
  workouts: Workout[];
  units: Settings['units'];
  order: readonly LiftId[];
  resets: readonly string[];
}) {
  // ROW is appended only once row data exists, so a pure 5/3/1 history never
  // shows a chip that opens onto a permanently empty chart.
  const chips = useMemo(() => e1rmLiftChips(order, workouts), [order, workouts]);
  const [lift, setLift] = useState<SlLiftId>(chips[0]!);
  // A block that ended can retire the ROW chip out from under the selection.
  const active = chips.includes(lift) ? lift : chips[0]!;
  const series = useMemo(
    () => buildE1rmSeries(workouts, active, units, resets),
    [workouts, active, units, resets],
  );
  const resetCaption = prResetCaption(resets);

  return (
    <>
      <LiftChips value={active} onChange={setLift} order={chips} />
      <HudPanel title={`${LIFT_NAMES[active]} · Estimated 1RM`}>
        {series.points.length === 0 ? (
          <EmptyState
            title="No effort data"
            message="Complete an AMRAP set — or a 5×5 session — to chart e1RM."
          />
        ) : (
          <>
            <div className="progress__stats">
              <Stat label="Latest" stat={series.latest} />
              <Stat label="Best" stat={series.best} />
            </div>
            <LineChart points={series.points} ariaLabel={`${LIFT_NAMES[active]} estimated 1RM over time`} />
            <p className="label text-low progress__caption">Amber diamonds mark personal records.</p>
            {resetCaption && <p className="label text-low progress__caption">{resetCaption}</p>}
          </>
        )}
      </HudPanel>
    </>
  );
}

// --- TM tab ----------------------------------------------------------------

function TmTab({
  cycles,
  tmEvents,
  units,
  order,
}: {
  cycles: Cycle[];
  tmEvents: TmEvent[];
  units: Settings['units'];
  order: readonly LiftId[];
}) {
  // Deliberately 4-lift: the barbell row has no training max.
  const [lift, setLift] = useState<LiftId>(order[0]!);
  const series = useMemo(() => buildTmStepSeries(cycles, lift, units), [cycles, lift, units]);
  const events = useMemo(
    () => tmEvents.filter((e) => e.liftId === lift).slice().reverse(),
    [tmEvents, lift],
  );

  return (
    <>
      <LiftChips value={lift} onChange={setLift} order={order} />
      <HudPanel title={`${LIFT_NAMES[lift]} · Training Max per Cycle`}>
        {series.points.length === 0 ? (
          <EmptyState title="No cycles yet" message="Training maxes appear once a cycle exists." />
        ) : (
          <>
            <div className="progress__stats">
              <Stat label="Current" stat={series.latest} />
            </div>
            <StepChart points={series.points} ariaLabel={`${LIFT_NAMES[lift]} training max per cycle`} />
          </>
        )}
      </HudPanel>

      <HudPanel title="TM Audit Log">
        {events.length === 0 ? (
          <p className="label text-mid">No TM changes recorded.</p>
        ) : (
          <ul className="tmlog">
            {events.map((e) => (
              <li key={e.id} className="tmlog__row">
                <span className={`label tmlog__type tmlog__type--${e.type}`}>
                  {e.type.replace('_', ' ')}
                </span>
                <span className="tmlog__flow num">
                  {e.fromValue !== null ? fmtWeight(e.fromValue) : '—'}
                  <span className="text-low"> → </span>
                  <span className="text-amber">{fmtWeight(e.toValue)}</span>
                </span>
                <span className="label text-low tmlog__date">{fmtShortDate(e.timestamp)}</span>
              </li>
            ))}
          </ul>
        )}
      </HudPanel>
    </>
  );
}

// --- Accessories tab -------------------------------------------------------

function AccessoriesTab({
  workouts,
  accessories,
  units,
}: {
  workouts: Workout[];
  accessories: AccessoryDef[];
  units: Settings['units'];
}) {
  const options = useMemo(() => accessoryOptions(accessories), [accessories]);
  const [selected, setSelected] = useState<string | null>(options[0]?.id ?? null);
  const activeId = selected ?? options[0]?.id ?? null;

  const series = useMemo(
    () => (activeId ? buildAccessorySeries(workouts, activeId, units) : null),
    [workouts, activeId, units],
  );

  if (options.length === 0) {
    return (
      <HudPanel title="Accessories">
        <EmptyState title="No accessories" message="Add accessories to track their weight over time.">
          <Link to="/accessories" className="progress__link label">
            Manage Accessories →
          </Link>
        </EmptyState>
      </HudPanel>
    );
  }

  return (
    <>
      <div className="progress__picker">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`chip chip--wide${activeId === o.id ? ' is-active' : ''}`}
            onClick={() => setSelected(o.id)}
          >
            {o.name}
            {o.archived && <span className="chip__tag label">archived</span>}
          </button>
        ))}
      </div>
      <HudPanel title="Accessory Weight">
        {series && series.points.length > 0 ? (
          <>
            <div className="progress__stats">
              <Stat label="Latest" stat={series.latest} />
            </div>
            <LineChart points={series.points} area={false} ariaLabel="Accessory weight over time" />
          </>
        ) : (
          <EmptyState title="No sessions logged" message="Complete a workout with this accessory." />
        )}
      </HudPanel>
      <Link to="/accessories" className="progress__link label">
        Manage Accessories →
      </Link>
    </>
  );
}

// --- Bodyweight tab --------------------------------------------------------

function BodyweightTab({
  entries,
  units,
}: {
  entries: BodyweightEntry[];
  units: Settings['units'];
}) {
  const series = useMemo(() => buildBodyweightSeries(entries, units), [entries, units]);
  return (
    <HudPanel title="Bodyweight">
      {series.points.length === 0 ? (
        <EmptyState title="No entries" message="Log bodyweight from the Today screen." />
      ) : (
        <>
          <div className="progress__stats">
            <Stat label="Latest" stat={series.latest} />
          </div>
          <LineChart points={series.points} ariaLabel="Bodyweight over time" />
        </>
      )}
    </HudPanel>
  );
}

// --- PRs tab ---------------------------------------------------------------

function PrsTab({ workouts, resets }: { workouts: Workout[]; resets: readonly string[] }) {
  const prs = useMemo(() => buildPrList(workouts, resets), [workouts, resets]);
  const resetCaption = prResetCaption(resets);
  return (
    <HudPanel title="Personal Records">
      {prs.length === 0 ? (
        <EmptyState title="No PRs yet" message="Set a new estimated 1RM to log a record." />
      ) : (
        <ul className="prlist">
          {prs.map((pr) => (
            <li key={pr.workoutId} className="prlist__row">
              <div className="prlist__main">
                <span className="label label-hi">{LIFT_NAMES[pr.liftId]}</span>
                <PrBadge />
              </div>
              <div className="prlist__stats">
                <span className="num prlist__lift">
                  {fmtWeight(pr.weight)}
                  <span className="label text-mid"> {pr.units.toUpperCase()} </span>
                  <span className="text-low">×</span> {pr.reps}
                </span>
                <span className="label text-cyan">e1RM {fmtWeight(pr.e1rm)}</span>
              </div>
              <span className="label text-low prlist__date">{fmtShortDate(pr.date)}</span>
            </li>
          ))}
        </ul>
      )}
      {resetCaption && <p className="label text-low progress__caption">{resetCaption}</p>}
    </HudPanel>
  );
}
