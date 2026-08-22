import { useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { BackupFile, Cycle, LiftId, Settings, Units } from '../../core/types.ts';
import { normalizeDayOrder } from '../../core/scheme.ts';
import { roundingIncrementOptions } from '../../core/units.ts';
import { db } from '../../db/db.ts';
import {
  exportBackup,
  importBackup,
  parseBackupJson,
  BackupValidationError,
} from '../../db/exportImport.ts';
import {
  clearPendingProgramSwitch,
  getActiveCycle,
  getSettings,
  getTrainingMaxes,
  listCycles,
  setPendingProgramSwitch,
  switchUnits,
  updateSettings,
} from '../../db/repo/index.ts';
import { shareBackup, defaultBackupFilename } from '../../pwa/share.ts';
import { getStorageEstimate } from '../../pwa/persistence.ts';
import { seedDemoData } from '../../db/devSeed.ts';
import { Button, HudPanel, Modal, NumberStepper, useToast } from '../../components/index.ts';
import { LIFT_NAMES } from '../shared/liftLabels.ts';
import { fmtWeight } from '../shared/format.ts';
import { TmOverrideModal } from '../cycle/TmOverrideModal.tsx';
import { deleteEverything } from './deleteEverything.ts';
import './settings.css';

/** App version — surfaced in the footer. */
export const APP_VERSION = '1.0.0';

interface SettingsData {
  settings: Settings | null;
  tms: Partial<Record<LiftId, number>>;
  cycleCount: number;
  workoutCount: number;
  /** The running cycle — its `program` decides which switch is on offer. */
  activeCycle: Cycle | null;
}

async function readSettings(): Promise<SettingsData> {
  const settings = (await getSettings()) ?? null;
  const [tms, cycles, workoutCount, activeCycle] = await Promise.all([
    getTrainingMaxes(),
    listCycles(),
    db.workouts.count(),
    getActiveCycle(),
  ]);
  return {
    settings,
    tms,
    cycleCount: cycles.length,
    workoutCount,
    activeCycle: activeCycle ?? null,
  };
}

export function SettingsScreen() {
  const data = useLiveQuery(() => readSettings(), []);
  const toast = useToast();

  if (data === undefined) {
    return (
      <div className="settings">
        <p className="label settings__loading">Loading…</p>
      </div>
    );
  }
  if (data.settings === null) {
    return (
      <div className="settings">
        <p className="label settings__loading">No settings yet.</p>
      </div>
    );
  }

  const { settings } = data;

  return (
    <div className="settings safe-top">
      <header className="settings__head">
        <h1 className="settings__title num">Settings</h1>
      </header>

      <ProgramSection settings={settings} toast={toast} activeCycle={data.activeCycle} />
      <TrainingMaxSection settings={settings} tms={data.tms} activeCycle={data.activeCycle} />
      <DataSection toast={toast} />
      <DangerSection />
      <Footer settings={settings} cycleCount={data.cycleCount} workoutCount={data.workoutCount} />
    </div>
  );
}

type ToastApi = ReturnType<typeof useToast>;

// --- PROGRAM ---------------------------------------------------------------

function ProgramSection({
  settings,
  toast,
  activeCycle,
}: {
  settings: Settings;
  toast: ToastApi;
  activeCycle: Cycle | null;
}) {
  const [pendingUnits, setPendingUnits] = useState<Units | null>(null);
  const [busy, setBusy] = useState(false);

  const roundingOptions = roundingIncrementOptions(settings.units);
  const tmStep = settings.units === 'kg' ? 1.25 : 5;
  const decimals = settings.units === 'kg' ? 2 : 0;

  const confirmUnitSwitch = async () => {
    if (pendingUnits === null || busy) return;
    setBusy(true);
    try {
      await switchUnits(pendingUnits);
      toast.show(`Units switched to ${pendingUnits.toUpperCase()}`, 'success');
      setPendingUnits(null);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Unit switch failed', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const setRounding = async (inc: number) => {
    try {
      await updateSettings({ roundingIncrement: inc });
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Update failed', 'danger');
    }
  };

  const setTmPercent = async (pct: number) => {
    try {
      await updateSettings({ tmPercent: pct });
      toast.show(`TM% set to ${Math.round(pct * 100)}%`, 'info');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Update failed', 'danger');
    }
  };

  const setLiftInc = async (liftId: LiftId, value: number) => {
    try {
      await updateSettings({ liftIncrements: { ...settings.liftIncrements, [liftId]: value } });
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Update failed', 'danger');
    }
  };

  const toggleDeload = async () => {
    try {
      await updateSettings({ includeDeload: !settings.includeDeload });
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Update failed', 'danger');
    }
  };

  const order = normalizeDayOrder(settings.dayOrder);

  const moveDay = async (index: number, dir: -1 | 1) => {
    const next = [...order];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j]!, next[index]!];
    try {
      await updateSettings({ dayOrder: next });
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Update failed', 'danger');
    }
  };

  const onSl = activeCycle?.program === 'sl5x5';
  const armTarget: NonNullable<Settings['pendingProgramSwitch']> = onSl ? 'five31' : 'sl5x5';
  const armed = settings.pendingProgramSwitch;
  const armedCopy = onSl
    ? 'Return to 5/3/1 at next cycle completion'
    : 'Switch to StrongLifts 5×5 at next cycle completion';

  const arm = async () => {
    try {
      await setPendingProgramSwitch(armTarget);
      toast.show('Armed — applied when you complete this cycle', 'info');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Update failed', 'danger');
    }
  };

  const disarm = async () => {
    try {
      await clearPendingProgramSwitch();
      toast.show('Program switch cancelled', 'info');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Update failed', 'danger');
    }
  };

  return (
    <HudPanel title="Program" className="settings__section">
      {/* The switch is ARMED here and APPLIED in the Complete-Cycle modal: a
          program change mid-cycle would strand half-trained rows, so the cycle
          boundary is the only safe seam. */}
      <Row label="Current">
        <span className="settings__tm">
          <span className="num num-md text-amber">{onSl ? '5×5' : '5/3/1'}</span>
          <span className="label text-low">{onSl ? 'StrongLifts' : "Wendler"}</span>
        </span>
      </Row>
      {armed !== undefined ? (
        <>
          <div className="settings__row">
            <span className="label settings__armed-chip">Armed</span>
            <Button variant="ghost" onClick={() => void disarm()}>
              Cancel
            </Button>
          </div>
          <p className="label text-low settings__hint">
            {armed === 'sl5x5'
              ? 'Switch to StrongLifts 5×5 at next cycle completion.'
              : 'Return to 5/3/1 at next cycle completion.'}
          </p>
        </>
      ) : (
        <>
          <Button variant="ghost" block onClick={() => void arm()}>
            {armedCopy}
          </Button>
          <p className="label text-low settings__hint">
            Preselects the choice in the Complete-Cycle screen. Nothing changes until then, and you
            can still pick the other option there.
          </p>
        </>
      )}

      <Row label="Units">
        <Segmented
          options={[
            { value: 'lb', label: 'LB' },
            { value: 'kg', label: 'KG' },
          ]}
          value={settings.units}
          onChange={(u) => {
            if (u !== settings.units) setPendingUnits(u);
          }}
        />
      </Row>

      <Row label="Rounding">
        <Segmented
          options={roundingOptions.map((inc) => ({ value: String(inc), label: `${inc}` }))}
          value={String(settings.roundingIncrement)}
          onChange={(v) => void setRounding(Number(v))}
        />
      </Row>

      <Row label="TM %">
        <Segmented
          options={[
            { value: '0.85', label: '85%' },
            { value: '0.9', label: '90%' },
          ]}
          value={String(settings.tmPercent)}
          onChange={(v) => void setTmPercent(Number(v))}
        />
      </Row>
      <p className="label text-low settings__hint">TM% affects future 1RM-derived training maxes only.</p>

      <div className="settings__subgroup">
        <span className="label text-mid">TM increments</span>
        {order.map((liftId) => (
          <Row key={liftId} label={LIFT_NAMES[liftId]}>
            <NumberStepper
              value={settings.liftIncrements[liftId]}
              onChange={(v) => void setLiftInc(liftId, v)}
              step={tmStep}
              min={tmStep}
              decimals={decimals}
              suffix={settings.units.toUpperCase()}
              label={`${LIFT_NAMES[liftId]} TM increment`}
            />
          </Row>
        ))}
      </div>

      <div className="settings__subgroup">
        <span className="label text-mid">Day order</span>
        {order.map((liftId, i) => (
          <div key={liftId} className="settings__dayrow">
            <span className="label text-low settings__daypos num">{i + 1}</span>
            <span className="label label-hi settings__dayname">{LIFT_NAMES[liftId]}</span>
            <div className="settings__daymove">
              <button
                type="button"
                className="settings__move"
                aria-label={`Move ${LIFT_NAMES[liftId]} earlier`}
                disabled={i === 0}
                onClick={() => void moveDay(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="settings__move"
                aria-label={`Move ${LIFT_NAMES[liftId]} later`}
                disabled={i === order.length - 1}
                onClick={() => void moveDay(i, 1)}
              >
                ↓
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="label text-low settings__hint">
        Order of training days within each week. Applies immediately — including the current cycle.
        Applies to 5/3/1 cycles — 5×5 ordering is fixed A/B.
      </p>

      <Row label="Deload default">
        <Toggle on={settings.includeDeload} onToggle={() => void toggleDeload()} />
      </Row>
      <p className="label text-low settings__hint">Applies to FUTURE cycles.</p>

      {pendingUnits && (
        <Modal open onClose={() => setPendingUnits(null)} title={`Switch to ${pendingUnits.toUpperCase()}?`}>
          <p className="label text-mid settings__modal-copy">
            This converts every training max, pending workout, and accessory weight to{' '}
            {pendingUnits.toUpperCase()} (re-rounded) and records a unit-conversion audit event.
            Historical workouts keep the units they were logged in.
          </p>
          <div className="settings__modal-actions">
            <Button variant="ghost" onClick={() => setPendingUnits(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" block onClick={() => void confirmUnitSwitch()} disabled={busy}>
              Convert
            </Button>
          </div>
        </Modal>
      )}
    </HudPanel>
  );
}

// --- TRAINING MAXES --------------------------------------------------------

function TrainingMaxSection({
  settings,
  tms,
  activeCycle,
}: {
  settings: Settings;
  tms: Partial<Record<LiftId, number>>;
  activeCycle: Cycle | null;
}) {
  const [overrideLift, setOverrideLift] = useState<LiftId | null>(null);
  const tmStep = settings.units === 'kg' ? 1.25 : 2.5;
  const order = normalizeDayOrder(settings.dayOrder);
  // During a block the TMs are DORMANT: the rows are driven by sl.lifts and
  // tmOverrideRepo throws on an SL cycle. Disable rather than let the user
  // discover that by hitting the error.
  const slActive = activeCycle?.program === 'sl5x5';

  return (
    <HudPanel title="Training Maxes" className="settings__section">
      {order.map((liftId) => (
        <Row key={liftId} label={LIFT_NAMES[liftId]}>
          <span className="settings__tm">
            <span className="num num-md text-amber">
              {tms[liftId] !== undefined ? fmtWeight(tms[liftId]!) : '—'}
            </span>
            <span className="label text-low">{settings.units.toUpperCase()}</span>
          </span>
          <Button
            variant="ghost"
            onClick={() => setOverrideLift(liftId)}
            disabled={slActive || tms[liftId] === undefined}
          >
            Edit
          </Button>
        </Row>
      ))}
      <p className="label text-low settings__hint">
        {slActive
          ? 'TMs resume when you return to 5/3/1.'
          : "Editing a TM regenerates only that lift's pending workouts."}
      </p>

      {overrideLift && tms[overrideLift] !== undefined && (
        <TmOverrideModal
          liftId={overrideLift}
          currentTm={tms[overrideLift]!}
          units={settings.units}
          step={tmStep}
          onClose={() => setOverrideLift(null)}
        />
      )}
    </HudPanel>
  );
}

// --- DATA ------------------------------------------------------------------

function DataSection({ toast }: { toast: ToastApi }) {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [busy, setBusy] = useState(false);
  const storage = useLiveQuery(() => getStorageEstimate(), []);
  const persisted = useLiveQuery(
    () => (typeof navigator !== 'undefined' && navigator.storage?.persisted
      ? navigator.storage.persisted()
      : Promise.resolve(false)),
    [],
  );

  const doExport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const backup = await exportBackup();
      const json = JSON.stringify(backup, null, 2);
      const result = await shareBackup(json, defaultBackupFilename());
      if (result === 'shared') toast.show('Backup shared', 'success');
      else if (result === 'downloaded') toast.show('Backup downloaded', 'success');
      else if (result === 'cancelled') toast.show('Export cancelled', 'info');
      else toast.show('Sharing not supported here', 'danger');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Export failed', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    try {
      const text = await file.text();
      const backup = parseBackupJson(text);
      setPending(backup);
    } catch (err) {
      if (err instanceof BackupValidationError) toast.show(err.message, 'danger');
      else toast.show('Could not read file', 'danger');
    }
  };

  const confirmImport = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await importBackup(pending);
      setPending(null);
      toast.show('Backup imported', 'success');
      navigate('/');
    } catch (err) {
      if (err instanceof BackupValidationError) toast.show(err.message, 'danger');
      else toast.show(err instanceof Error ? err.message : 'Import failed', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const summary = pending
    ? `${pending.data?.cycles?.length ?? 0} cycles · ${pending.data?.workouts?.length ?? 0} workouts · ${pending.data?.accessories?.length ?? 0} accessories`
    : '';

  return (
    <HudPanel title="Data" className="settings__section">
      <Button variant="primary" block onClick={() => void doExport()} disabled={busy}>
        Export Backup
      </Button>
      <Button variant="ghost" block onClick={() => fileRef.current?.click()} disabled={busy}>
        Import Backup
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={(e) => void onFile(e)}
      />

      <div className="settings__storage">
        <span className="label text-mid">Storage</span>
        {storage ? (
          <span className="label text-low">
            {mb(storage.usage)} / {mb(storage.quota)} MB
            {persisted ? ' · persisted' : ''}
          </span>
        ) : (
          <span className="label text-low">Unavailable</span>
        )}
      </div>

      {pending && (
        <Modal open onClose={() => setPending(null)} title="Replace all data?">
          <p className="label text-mid settings__modal-copy">
            This backup contains {summary}. Importing REPLACES ALL current data on this device. This
            cannot be undone.
          </p>
          <div className="settings__modal-actions">
            <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" block onClick={() => void confirmImport()} disabled={busy}>
              Replace All Data
            </Button>
          </div>
        </Modal>
      )}
    </HudPanel>
  );
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

// --- DANGER ----------------------------------------------------------------

function DangerSection() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    if (confirmText !== 'RESET' || busy) return;
    setBusy(true);
    await deleteEverything(); // reloads the page
  };

  return (
    <HudPanel title="Danger" className="settings__section settings__danger">
      <Button variant="danger" block onClick={() => setOpen(true)}>
        Full Reset
      </Button>
      <p className="label text-low settings__hint">Erases everything on this device.</p>

      {open && (
        <Modal
          open
          onClose={() => {
            setOpen(false);
            setConfirmText('');
          }}
          title="Full reset"
        >
          <p className="label text-mid settings__modal-copy">
            This permanently deletes all cycles, workouts, accessories, and settings. Type{' '}
            <span className="text-danger">RESET</span> to confirm.
          </p>
          <input
            className="settings__reset-input"
            value={confirmText}
            placeholder="RESET"
            onChange={(e) => setConfirmText(e.target.value)}
            aria-label="Type RESET to confirm"
          />
          <div className="settings__modal-actions">
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setConfirmText('');
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              block
              onClick={() => void reset()}
              disabled={busy || confirmText !== 'RESET'}
            >
              Erase Everything
            </Button>
          </div>
        </Modal>
      )}
    </HudPanel>
  );
}

// --- FOOTER (with hidden dev seed) -----------------------------------------

function Footer({
  settings,
  cycleCount,
  workoutCount,
}: {
  settings: Settings;
  cycleCount: number;
  workoutCount: number;
}) {
  const toast = useToast();
  const [showSeed, setShowSeed] = useState(false);
  const [busy, setBusy] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startHold = () => {
    holdTimer.current = setTimeout(() => setShowSeed(true), 800);
  };
  const cancelHold = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const seed = async (n: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await seedDemoData(n);
      toast.show(`Seeded ${n} cycles`, 'success');
      // Reload so every screen re-reads the fresh DB cleanly. Force the hash to
      // Today first so a reload can never boot into the onboarding wizard.
      if (typeof location !== 'undefined') {
        location.hash = '#/';
        location.reload();
      }
    } catch (err) {
      setBusy(false);
      toast.show(err instanceof Error ? err.message : 'Seed failed', 'danger');
    }
  };

  return (
    <footer className="settings__footer">
      <Link to="/accessories" className="settings__manage label">
        Manage Accessories →
      </Link>
      <p
        className="label text-low settings__version"
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
      >
        FIVE31 v{APP_VERSION} · {cycleCount} cycles · {workoutCount} workouts · {settings.units.toUpperCase()}
      </p>

      {showSeed && (
        <div className="settings__seed">
          <span className="label text-cyan">DEV: SEED DEMO DATA</span>
          <div className="settings__seed-actions">
            <Button variant="ghost" onClick={() => void seed(1)} disabled={busy}>
              1
            </Button>
            <Button variant="ghost" onClick={() => void seed(3)} disabled={busy}>
              3
            </Button>
            <Button variant="ghost" onClick={() => void seed(12)} disabled={busy}>
              12
            </Button>
          </div>
          <p className="label text-low settings__hint">Wipes and regenerates all data.</p>
        </div>
      )}
    </footer>
  );
}

// --- Small building blocks -------------------------------------------------

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings__row">
      <span className="label text-mid settings__row-label">{label}</span>
      <span className="settings__row-control">{children}</span>
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented segmented--inline">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`segmented__seg${value === o.value ? ' is-active' : ''}`}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`toggle${on ? ' is-on' : ''}`}
      onClick={onToggle}
    >
      <span className="toggle__knob" aria-hidden="true" />
    </button>
  );
}
