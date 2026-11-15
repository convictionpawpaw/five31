import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { AccessoryDef, LiftId, Settings, Workout } from '../../core/types.ts';
import { DAY_ORDER, normalizeDayOrder } from '../../core/scheme.ts';
import { defaultAccessoryIncrement } from '../../core/units.ts';
import { db } from '../../db/db.ts';
import {
  addAccessory,
  archiveAccessory,
  getSettings,
  reorderAccessories,
  unarchiveAccessory,
  updateAccessory,
  MAX_ACTIVE_ACCESSORIES_PER_DAY,
  type NewAccessoryInput,
} from '../../db/repo/index.ts';
import { Button, HudPanel, Modal, NumberStepper, useToast } from '../../components/index.ts';
import { LIFT_NAMES } from '../shared/liftLabels.ts';
import { fmtWeight } from '../shared/format.ts';
import { Sparkline } from '../progress/charts/index.ts';
import { accessorySparklineValues } from '../progress/progressData.ts';
import './accessories.css';

interface AccData {
  settings: Settings | null;
  accessories: AccessoryDef[];
  workouts: Workout[];
}

async function readAcc(): Promise<AccData> {
  const settings = (await getSettings()) ?? null;
  const [accessories, workouts] = await Promise.all([db.accessories.toArray(), db.workouts.toArray()]);
  return { settings, accessories, workouts };
}

/** Editable accessory fields for the add/edit modal. */
interface AccForm {
  name: string;
  sets: number;
  repRangeMin: number;
  repRangeMax: number;
  currentWeight: number;
  increment: number;
}

export function AccessoriesScreen() {
  const data = useLiveQuery(() => readAcc(), []);
  const toast = useToast();

  const [editTarget, setEditTarget] = useState<AccessoryDef | null>(null);
  const [addDay, setAddDay] = useState<LiftId | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<AccessoryDef | null>(null);

  const byDay = useMemo(() => {
    const map = new Map<LiftId, { active: AccessoryDef[]; archived: AccessoryDef[] }>();
    for (const liftId of DAY_ORDER) map.set(liftId, { active: [], archived: [] });
    if (data) {
      for (const a of data.accessories) {
        const bucket = map.get(a.liftDayId);
        if (!bucket) continue;
        if (a.archivedAt === undefined) bucket.active.push(a);
        else bucket.archived.push(a);
      }
      for (const bucket of map.values()) {
        bucket.active.sort((x, y) => x.order - y.order);
        bucket.archived.sort((x, y) => x.order - y.order);
      }
    }
    return map;
  }, [data]);

  if (data === undefined) {
    return (
      <div className="acc">
        <p className="label acc__loading">Loading…</p>
      </div>
    );
  }
  if (data.settings === null) {
    return (
      <div className="acc">
        <p className="label acc__loading">No data yet.</p>
      </div>
    );
  }

  const { settings, workouts } = data;
  const unitInc = defaultAccessoryIncrement(settings.units);
  const order = normalizeDayOrder(settings.dayOrder);

  const doReorder = async (liftId: LiftId, ids: string[]) => {
    try {
      await reorderAccessories(liftId, ids);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Reorder failed', 'danger');
    }
  };

  const doArchive = async (a: AccessoryDef) => {
    try {
      await archiveAccessory(a.id);
      toast.show(`${a.name} archived`, 'info');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Archive failed', 'danger');
    } finally {
      setArchiveTarget(null);
    }
  };

  const doUnarchive = async (a: AccessoryDef) => {
    try {
      // The cap is re-checked transactionally inside the repo — the UI count is
      // only an early hint and can be stale on rapid taps.
      await unarchiveAccessory(a.id);
      toast.show(`${a.name} restored`, 'success');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Restore failed', 'danger');
    }
  };

  return (
    <div className="acc safe-top">
      <header className="acc__head">
        <h1 className="acc__title num">Accessories</h1>
        <p className="label text-mid">Max {MAX_ACTIVE_ACCESSORIES_PER_DAY} per day</p>
      </header>

      {order.map((liftId) => {
        const bucket = byDay.get(liftId)!;
        return (
          <section key={liftId} className="acc__day">
            <div className="acc__day-head">
              <h2 className="label label-hi acc__day-title">{LIFT_NAMES[liftId]}</h2>
              <Button
                variant="ghost"
                onClick={() => setAddDay(liftId)}
                disabled={bucket.active.length >= MAX_ACTIVE_ACCESSORIES_PER_DAY}
              >
                + Add
              </Button>
            </div>

            {bucket.active.length === 0 ? (
              <p className="label text-low acc__empty">No accessories on this day.</p>
            ) : (
              bucket.active.map((a, i) => (
                <AccessoryCard
                  key={a.id}
                  accessory={a}
                  units={settings.units}
                  workouts={workouts}
                  canMoveUp={i > 0}
                  canMoveDown={i < bucket.active.length - 1}
                  onEdit={() => setEditTarget(a)}
                  onArchive={() => setArchiveTarget(a)}
                  onMove={(dir) => {
                    const ids = bucket.active.map((x) => x.id);
                    const j = i + dir;
                    if (j < 0 || j >= ids.length) return;
                    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
                    void doReorder(liftId, ids);
                  }}
                />
              ))
            )}

            {bucket.archived.length > 0 && (
              <ArchivedSection
                items={bucket.archived}
                activeCount={bucket.active.length}
                onUnarchive={(a) => void doUnarchive(a)}
              />
            )}
          </section>
        );
      })}

      {addDay && (
        <AccessoryModal
          title={`Add — ${LIFT_NAMES[addDay]}`}
          units={settings.units}
          initial={{
            name: '',
            sets: 3,
            repRangeMin: 8,
            repRangeMax: 12,
            currentWeight: unitInc * 4,
            increment: unitInc,
          }}
          onClose={() => setAddDay(null)}
          onSubmit={async (form) => {
            const input: NewAccessoryInput = { liftDayId: addDay, ...form };
            try {
              await addAccessory(input);
              toast.show(`${form.name || 'Accessory'} added`, 'success');
              setAddDay(null);
            } catch (err) {
              toast.show(err instanceof Error ? err.message : 'Add failed', 'danger');
            }
          }}
        />
      )}

      {editTarget && (
        <AccessoryModal
          title={`Edit — ${editTarget.name}`}
          units={settings.units}
          initial={{
            name: editTarget.name,
            sets: editTarget.sets,
            repRangeMin: editTarget.repRangeMin,
            repRangeMax: editTarget.repRangeMax,
            currentWeight: editTarget.currentWeight,
            increment: editTarget.increment,
          }}
          onClose={() => setEditTarget(null)}
          onSubmit={async (form) => {
            try {
              await updateAccessory(editTarget.id, form);
              toast.show('Accessory updated', 'success');
              setEditTarget(null);
            } catch (err) {
              toast.show(err instanceof Error ? err.message : 'Update failed', 'danger');
            }
          }}
        />
      )}

      {archiveTarget && (
        <Modal open onClose={() => setArchiveTarget(null)} title={`Archive ${archiveTarget.name}?`}>
          <p className="label text-mid acc__modal-copy">
            Archiving removes this accessory from future workouts. History keeps its snapshots and
            you can restore it later.
          </p>
          <div className="acc__modal-actions">
            <Button variant="ghost" onClick={() => setArchiveTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" block onClick={() => void doArchive(archiveTarget)}>
              Archive
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AccessoryCard({
  accessory,
  units,
  workouts,
  canMoveUp,
  canMoveDown,
  onEdit,
  onArchive,
  onMove,
}: {
  accessory: AccessoryDef;
  units: Settings['units'];
  workouts: Workout[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const spark = useMemo(
    () => accessorySparklineValues(workouts, accessory.id, units, 6),
    [workouts, accessory.id, units],
  );

  return (
    <HudPanel className="acccard">
      <div className="acccard__top">
        <div className="acccard__info">
          <span className="label label-hi acccard__name">{accessory.name}</span>
          <span className="label text-mid">
            {accessory.sets} × {accessory.repRangeMin}-{accessory.repRangeMax}
          </span>
        </div>
        <div className="acccard__weight">
          <span className="num acccard__w">{fmtWeight(accessory.currentWeight)}</span>
          <span className="label text-low">
            {units.toUpperCase()} · +{fmtWeight(accessory.increment)}
          </span>
        </div>
      </div>

      {spark.length >= 2 && (
        <Sparkline values={spark} ariaLabel={`${accessory.name} recent weights`} />
      )}

      <div className="acccard__actions">
        <div className="acccard__reorder">
          <button
            type="button"
            className="acccard__move"
            aria-label="Move up"
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="acccard__move"
            aria-label="Move down"
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
        </div>
        <Button variant="ghost" onClick={onEdit}>
          Edit
        </Button>
        <Button variant="ghost" onClick={onArchive}>
          Archive
        </Button>
      </div>
    </HudPanel>
  );
}

function ArchivedSection({
  items,
  activeCount,
  onUnarchive,
}: {
  items: AccessoryDef[];
  activeCount: number;
  onUnarchive: (a: AccessoryDef) => void;
}) {
  const [open, setOpen] = useState(false);
  const canRestore = activeCount < MAX_ACTIVE_ACCESSORIES_PER_DAY;
  return (
    <div className="acc__archived">
      <button
        type="button"
        className="acc__archived-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="label text-low">Archived ({items.length})</span>
        <span className="label text-low">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ul className="acc__archived-list">
          {items.map((a) => (
            <li key={a.id} className="acc__archived-row">
              <span className="label text-mid">{a.name}</span>
              <Button variant="ghost" onClick={() => onUnarchive(a)} disabled={!canRestore}>
                Restore
              </Button>
            </li>
          ))}
          {!canRestore && (
            <li className="acc__archived-note label text-low">
              Day is full — archive an active accessory to restore one.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function AccessoryModal({
  title,
  units,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  units: Settings['units'];
  initial: AccForm;
  onClose: () => void;
  onSubmit: (form: AccForm) => void | Promise<void>;
}) {
  const [form, setForm] = useState<AccForm>(initial);
  const [busy, setBusy] = useState(false);
  const weightStep = units === 'kg' ? 1.25 : 5;

  const patch = <K extends keyof AccForm>(key: K, value: AccForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    if (busy) return;
    // Keep the rep range coherent (max >= min).
    const safe: AccForm = {
      ...form,
      name: form.name.trim(),
      repRangeMax: Math.max(form.repRangeMax, form.repRangeMin),
    };
    if (safe.name.length === 0) return;
    setBusy(true);
    try {
      await onSubmit(safe);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="accform">
        <label className="accform__field">
          <span className="label text-mid">Name</span>
          <input
            className="accform__input"
            value={form.name}
            placeholder="e.g. Chin-ups"
            onChange={(e) => patch('name', e.target.value)}
          />
        </label>

        <div className="accform__field">
          <span className="label text-mid">Sets</span>
          <NumberStepper value={form.sets} onChange={(v) => patch('sets', v)} step={1} min={1} max={10} label="Sets" />
        </div>

        <div className="accform__rangerow">
          <div className="accform__field">
            <span className="label text-mid">Rep min</span>
            <NumberStepper
              value={form.repRangeMin}
              onChange={(v) => patch('repRangeMin', v)}
              step={1}
              min={1}
              max={form.repRangeMax}
              label="Rep range min"
            />
          </div>
          <div className="accform__field">
            <span className="label text-mid">Rep max</span>
            <NumberStepper
              value={form.repRangeMax}
              onChange={(v) => patch('repRangeMax', v)}
              step={1}
              min={form.repRangeMin}
              max={50}
              label="Rep range max"
            />
          </div>
        </div>

        <div className="accform__field">
          <span className="label text-mid">Current weight</span>
          <NumberStepper
            value={form.currentWeight}
            onChange={(v) => patch('currentWeight', v)}
            step={weightStep}
            min={0}
            suffix={units.toUpperCase()}
            label="Current weight"
          />
        </div>

        <div className="accform__field">
          <span className="label text-mid">Increment</span>
          <NumberStepper
            value={form.increment}
            onChange={(v) => patch('increment', v)}
            step={weightStep}
            min={weightStep}
            suffix={units.toUpperCase()}
            label="Increment"
          />
        </div>

        <div className="accform__actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" block onClick={() => void submit()} disabled={busy || form.name.trim().length === 0}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
