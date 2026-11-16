import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BODY_AREAS,
  BODY_AREA_LABELS,
  type BodyArea,
  type Equipment,
  type Reps,
  type Routine,
  type RoutineMode,
  type SavedRoutine,
  type WarmupLift,
} from '../../core/stretch/types.ts';
import { generateRoutine, MAX_MINUTES, MIN_MINUTES } from '../../core/stretch/generator.ts';
import {
  MODE_LABELS,
  MODE_PROFILES,
  WARMUP_LIFTS,
  WARMUP_LIFT_LABELS,
  isRoutineMode,
  isWarmupLift,
  modeEquipment,
  modePool,
  suggestedMode,
  type TemplateMode,
} from '../../core/stretch/modes.ts';
import { STRETCHES, getStretch } from '../../core/stretch/library.ts';
import { resolveStep } from '../../core/stretch/variant.ts';
import { matchAreas } from '../../core/stretch/matchAreas.ts';
import { computeStreak } from '../../core/stretch/streak.ts';
import { addSavedRoutine, listStretchSessions, recentStretchIds } from '../../db/repo/index.ts';
import { Button, HudPanel, useToast } from '../../components/index.ts';
import { StretchFigure } from './StretchFigure.tsx';
import { StreakPanel } from './StreakPanel.tsx';
import { SavedRoutinesPanel } from './SavedRoutinesPanel.tsx';
import { RoutineNameModal } from './RoutineNameModal.tsx';
import {
  NECK_BACK_CHEST,
  defaultRoutineName,
  distinctStretchCount,
  missingStretchIds,
  stepRuns,
} from './routineFormat.ts';
import { loadStretchPrefs, saveStretchPrefs, type StretchPrefs } from './stretchPrefs.ts';
import { unlockAudio } from './stretchAudio.ts';
import { armAutostart } from './playerLaunch.ts';
import { useToday } from './useToday.ts';
import { fmtClock } from './stretchFormat.ts';
import { recentModeCounts } from './modeStats.ts';
import { readNextWarmupLift } from './nextLift.ts';
import './stretch.css';
import './modes.css';

const FOCUS_DURATIONS = Array.from(
  { length: MAX_MINUTES - MIN_MINUTES + 1 },
  (_, i) => MIN_MINUTES + i,
);
const FOCUS_REPEATS: readonly Reps[] = [1, 2, 3];

const MODE_CARDS: readonly { mode: RoutineMode; hint: string }[] = [
  { mode: 'warmup', hint: 'Before lifting' },
  { mode: 'midday', hint: 'Desk break' },
  { mode: 'winddown', hint: 'Before bed' },
  { mode: 'focus', hint: 'Pick areas' },
];

const EQUIPMENT_LABELS: Record<Equipment, string> = {
  chair: 'Chair',
  wall: 'Wall',
  doorway: 'Doorway',
  band: 'Band',
  roller: 'Roller',
  bar: 'Bar',
};

type LiftChoice = WarmupLift | 'general';

function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

function durationsFor(mode: RoutineMode): number[] {
  if (mode === 'focus') return FOCUS_DURATIONS;
  const p = MODE_PROFILES[mode];
  return Array.from({ length: p.maxMinutes - p.minMinutes + 1 }, (_, i) => p.minMinutes + i);
}

async function readStretch() {
  const [sessions, recent] = await Promise.all([listStretchSessions(), recentStretchIds()]);
  return { sessions, recent };
}

/** Router state handed to the player. */
export interface StretchPlayState {
  routine: Routine;
  /** Started from a saved routine (the completion view then offers no Save). */
  fromSaved?: boolean;
}

/**
 * Router state the Stretch screen accepts (Today's warm-up shortcut): which
 * card to open and, for a warm-up, the lift. Read once at mount; never starts
 * anything.
 */
export interface StretchScreenState {
  mode?: RoutineMode;
  lift?: WarmupLift;
}

function parseScreenState(state: unknown): StretchScreenState {
  const s = (state ?? {}) as Record<string, unknown>;
  return {
    mode: isRoutineMode(s.mode) ? s.mode : undefined,
    lift: isWarmupLift(s.lift) ? s.lift : undefined,
  };
}

/**
 * Stretch home: streak HUD, four routine-type cards (Warm-up, Midday,
 * Wind-down, Focused; the one that fits the time of day highlighted), the
 * open card's builder with a preview and Shuffle / Save / Start, and the
 * saved routines.
 */
export function StretchScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const data = useLiveQuery(readStretch, []);
  // undefined while loading, null when there is no next workout.
  const nextLift = useLiveQuery(readNextWarmupLift, []);
  const [prefs] = useState(loadStretchPrefs);
  const [launch] = useState(() => parseScreenState(location.state));
  const [suggested] = useState(() => suggestedMode(new Date()));
  const [open, setOpen] = useState<RoutineMode | null>(launch.mode ?? null);

  // Focused builder.
  const [minutes, setMinutes] = useState(prefs.minutes);
  const [reps, setReps] = useState<Reps>(prefs.reps);
  const [focus, setFocus] = useState<BodyArea[]>(prefs.focusAreas);
  const [text, setText] = useState('');
  const [matchMsg, setMatchMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Template modes.
  const [modeMinutes, setModeMinutes] = useState(prefs.modeMinutes);
  const [excluded, setExcluded] = useState(prefs.excluded);
  const [middayReps, setMiddayReps] = useState<Reps>(prefs.middayReps);
  const [liftChoice, setLiftChoice] = useState<LiftChoice | null>(launch.lift ?? null);

  const [seed, setSeed] = useState(randomSeed);
  const [saving, setSaving] = useState(false);

  // The user's pick, else today's next lift, else a general warm-up.
  const lift: WarmupLift | undefined = (() => {
    const c = liftChoice ?? nextLift ?? 'general';
    return c === 'general' ? undefined : c;
  })();

  const recent = data?.recent;
  const routine = useMemo(() => {
    if (recent === undefined || open === null) return null;
    if (open === 'focus') {
      return generateRoutine({
        mode: 'focus',
        minutes,
        focusAreas: focus,
        seed,
        reps,
        excluded: excluded.focus,
        recentStretchIds: recent,
      });
    }
    return generateRoutine({
      mode: open,
      minutes: modeMinutes[open],
      focusAreas: [],
      seed,
      reps: open === 'midday' ? middayReps : undefined,
      excluded: excluded[open],
      lift: open === 'warmup' ? lift : undefined,
      recentStretchIds: recent,
    });
  }, [open, minutes, focus, seed, reps, modeMinutes, middayReps, excluded, lift, recent]);

  const today = useToday();
  const streak = useMemo(() => (data ? computeStreak(data.sessions, today) : null), [data, today]);
  const modeCounts = useMemo(
    () => (data ? recentModeCounts(data.sessions, today) : []),
    [data, today],
  );
  const equipment = useMemo(() => (open ? modeEquipment(open, STRETCHES) : []), [open]);

  const setPrefs = (patch: Partial<StretchPrefs>) => saveStretchPrefs(patch);

  const chooseMinutes = (m: number) => {
    if (open === null) return;
    if (open === 'focus') {
      setMinutes(m);
      setPrefs({ minutes: m });
      return;
    }
    const next = { ...modeMinutes, [open]: m };
    setModeMinutes(next);
    setPrefs({ modeMinutes: next });
  };
  const chooseReps = (r: Reps) => {
    setReps(r);
    setPrefs({ reps: r });
  };
  const chooseMiddayReps = (r: Reps) => {
    setMiddayReps(r);
    setPrefs({ middayReps: r });
  };
  const toggleEquipment = (e: Equipment) => {
    if (open === null) return;
    const cur = excluded[open];
    const list = cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e];
    const next = { ...excluded, [open]: list };
    setExcluded(next);
    setPrefs({ excluded: next });
  };
  const chooseFocus = (areas: BodyArea[]) => {
    const ordered = BODY_AREAS.filter((a) => areas.includes(a));
    setFocus(ordered);
    setPrefs({ focusAreas: ordered });
  };
  const toggleArea = (a: BodyArea) => {
    chooseFocus(focus.includes(a) ? focus.filter((x) => x !== a) : [...focus, a]);
    setMatchMsg(null);
  };

  const onMatch = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim() === '') return;
    const areas = matchAreas(text);
    if (areas.length === 0) {
      setMatchMsg({
        ok: false,
        text: "Didn't recognise any body areas. Pick them from the chips below.",
      });
      return;
    }
    chooseFocus(areas);
    setMatchMsg({ ok: true, text: `Focus: ${areas.map((a) => BODY_AREA_LABELS[a]).join(', ')}` });
  };

  /** The one launch path (Start and saved routines); must run inside the tap. */
  const launchRoutine = (r: Routine, fromSaved: boolean) => {
    // Created inside the tap so iOS allows the player's audio cues.
    unlockAudio();
    // One-shot token: the player auto-starts only when mounted from this tap.
    armAutostart();
    const state: StretchPlayState = fromSaved ? { routine: r, fromSaved } : { routine: r };
    navigate('/stretch/play', { state });
  };
  const start = () => {
    if (routine && routine.steps.length > 0) launchRoutine(routine, false);
  };
  const startSaved = (saved: SavedRoutine) => {
    if (saved.routine.steps.length === 0 || missingStretchIds(saved.routine).length > 0) {
      toast.show(
        'This routine uses a stretch that is no longer in the app, so it cannot start.',
        'danger',
      );
      return;
    }
    launchRoutine(saved.routine, true);
  };

  const curMinutes = open === null ? 0 : open === 'focus' ? minutes : modeMinutes[open];
  const durations = open ? durationsFor(open) : [];

  return (
    <div className="stretch safe-top">
      <header className="stretch__head">
        <h1 className="stretch__title label label-hi">Stretch</h1>
        <Link to="/stretch/gallery" className="stretch__link label">
          All stretches →
        </Link>
      </header>

      {streak ? (
        <StreakPanel summary={streak} modeCounts={modeCounts} />
      ) : (
        <HudPanel title="Streak">
          <p className="label text-low">Loading…</p>
        </HudPanel>
      )}

      <div className="smode__cards" role="group" aria-label="Routine type">
        {MODE_CARDS.map(({ mode, hint }) => {
          const isOpen = open === mode;
          const range =
            mode === 'focus'
              ? `${MIN_MINUTES}-${MAX_MINUTES}`
              : `${MODE_PROFILES[mode].minMinutes}-${MODE_PROFILES[mode].maxMinutes}`;
          return (
            <button
              key={mode}
              type="button"
              className={[
                'smode__card',
                isOpen ? 'is-open' : '',
                suggested === mode ? 'is-suggested' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-expanded={isOpen}
              aria-controls="stretch-builder"
              onClick={() => {
                setOpen(isOpen ? null : mode);
                setSaving(false);
              }}
            >
              <span className="smode__card-title">{MODE_LABELS[mode]}</span>
              <span className="smode__card-hint label">
                {hint} · {range} min
              </span>
              {suggested === mode && <span className="smode__now label">Now</span>}
            </button>
          );
        })}
      </div>

      {open !== null && (
        <HudPanel
          title={`${MODE_LABELS[open]} routine`}
          className="stretch__builder"
          id="stretch-builder"
        >
          <div className="stretch__field">
            <span className="label">Minutes</span>
            <div
              className="stretch__durations"
              role="group"
              aria-label="Duration"
              style={{ gridTemplateColumns: `repeat(${durations.length}, 1fr)` }}
            >
              {durations.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`stretch__seg num${m === curMinutes ? ' is-on' : ''}`}
                  aria-pressed={m === curMinutes}
                  onClick={() => chooseMinutes(m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {open === 'warmup' && (
            <div className="stretch__field">
              <span className="label">
                Lift
                {nextLift ? (
                  <span className="text-low"> · next workout: {WARMUP_LIFT_LABELS[nextLift]}</span>
                ) : null}
              </span>
              <div
                className="stretch__durations smode__lifts"
                role="group"
                aria-label="Lift to warm up for"
              >
                {[...WARMUP_LIFTS, 'general' as const].map((l) => {
                  const on = (lift ?? 'general') === l;
                  return (
                    <button
                      key={l}
                      type="button"
                      className={`stretch__seg smode__lift${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() => setLiftChoice(l)}
                    >
                      {l === 'general' ? 'General' : WARMUP_LIFT_LABELS[l]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {open === 'midday' && (
            <RepeatsField
              options={MODE_PROFILES.midday.reps}
              value={middayReps}
              onChange={chooseMiddayReps}
            />
          )}

          {open === 'focus' && (
            <>
              <RepeatsField options={FOCUS_REPEATS} value={reps} onChange={chooseReps} />

              <form className="stretch__field" onSubmit={onMatch}>
                <label className="label" htmlFor="stretch-text">
                  What feels tight?
                </label>
                <div className="stretch__textrow">
                  <input
                    id="stretch-text"
                    className="stretch__input"
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    placeholder="e.g. stiff neck, low back"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <Button type="submit" variant="ghost" disabled={text.trim() === ''}>
                    Match
                  </Button>
                </div>
                {matchMsg && (
                  <p
                    className={`stretch__match ${matchMsg.ok ? 'text-cyan' : 'text-amber'}`}
                    role="status"
                  >
                    {matchMsg.text}
                  </p>
                )}
              </form>

              <FocusChips
                focus={focus}
                onAll={() => {
                  chooseFocus([]);
                  setMatchMsg(null);
                }}
                onPreset={() => {
                  chooseFocus([...NECK_BACK_CHEST]);
                  setMatchMsg(null);
                }}
                onToggle={toggleArea}
              />
            </>
          )}

          {equipment.length > 0 && (
            <div className="stretch__field">
              <span className="label">
                Equipment <span className="text-low">· tap to leave out</span>
              </span>
              <div className="stretch__chips">
                {equipment.map((e) => {
                  const out = excluded[open].includes(e);
                  return (
                    <button
                      key={e}
                      type="button"
                      className={`stretch__chip smode__equip${out ? ' is-out' : ''}`}
                      aria-pressed={out}
                      aria-label={`${EQUIPMENT_LABELS[e]}: ${out ? 'left out' : 'available'}`}
                      onClick={() => toggleEquipment(e)}
                    >
                      {EQUIPMENT_LABELS[e]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {open === 'winddown' && (
            <p className="smode__note label text-low">
              On the floor, no chair. Slow holds, finishing on your back.
            </p>
          )}
        </HudPanel>
      )}

      {open !== null && (
        <HudPanel title="Routine" active className="stretch__preview">
          {routine ? (
            <Preview
              routine={routine}
              mode={open}
              excludedAny={excluded[open].length > 0}
              onShuffle={() => setSeed(randomSeed())}
              onSave={() => setSaving(true)}
              onStart={start}
            />
          ) : (
            <p className="label text-low">Loading…</p>
          )}
          {saving && routine && (
            <RoutineNameModal
              title="Save routine"
              initialName={defaultRoutineName(routine)}
              confirmLabel="Save"
              onClose={() => setSaving(false)}
              onSubmit={async (name) => {
                await addSavedRoutine(name, routine);
                setSaving(false);
                toast.show('Routine saved', 'success');
              }}
            />
          )}
        </HudPanel>
      )}

      <SavedRoutinesPanel onStart={startSaved} />

      <p className="stretch__disclaimer">
        General flexibility guidance, not medical advice. Stop any stretch that causes pain.
      </p>
    </div>
  );
}

function RepeatsField({
  options,
  value,
  onChange,
}: {
  options: readonly Reps[];
  value: Reps;
  onChange: (r: Reps) => void;
}) {
  return (
    <div className="stretch__field">
      <span className="label">Repeats</span>
      <div
        className="stretch__durations stretch__repeats"
        role="group"
        aria-label="Repeats"
        style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
      >
        {options.map((r) => (
          <button
            key={r}
            type="button"
            className={`stretch__seg num${r === value ? ' is-on' : ''}`}
            aria-pressed={r === value}
            aria-label={`Each stretch ${r === 1 ? 'once' : `${r} times`}`}
            onClick={() => onChange(r)}
          >
            {r}x
          </button>
        ))}
      </div>
    </div>
  );
}

function FocusChips({
  focus,
  onAll,
  onPreset,
  onToggle,
}: {
  focus: BodyArea[];
  onAll: () => void;
  onPreset: () => void;
  onToggle: (a: BodyArea) => void;
}) {
  const presetActive =
    focus.length === NECK_BACK_CHEST.length && NECK_BACK_CHEST.every((a) => focus.includes(a));
  return (
    <div className="stretch__field">
      <span className="label">Focus</span>
      <div className="stretch__chips">
        <button
          type="button"
          className={`stretch__chip${focus.length === 0 ? ' is-on' : ''}`}
          aria-pressed={focus.length === 0}
          onClick={onAll}
        >
          Well-rounded
        </button>
        <button
          type="button"
          className={`stretch__chip stretch__chip--preset${presetActive ? ' is-on' : ''}`}
          aria-pressed={presetActive}
          onClick={onPreset}
        >
          Neck + back + chest
        </button>
        {BODY_AREAS.map((a) => (
          <button
            key={a}
            type="button"
            className={`stretch__chip${focus.includes(a) ? ' is-on' : ''}`}
            aria-pressed={focus.includes(a)}
            onClick={() => onToggle(a)}
          >
            {BODY_AREA_LABELS[a]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What the routine is, after the count and length. */
function routineDescription(r: Routine, mode: RoutineMode): string {
  switch (mode) {
    case 'warmup':
      return r.lift ? `For ${WARMUP_LIFT_LABELS[r.lift]}` : 'General';
    case 'midday':
      return 'Desk break';
    case 'winddown':
      return 'Slow, on the floor';
    case 'focus':
      return r.focusAreas.length === 0
        ? 'Well-rounded'
        : r.focusAreas.map((a) => BODY_AREA_LABELS[a]).join(', ');
  }
}

/** Why a routine came out empty. */
function emptyText(mode: RoutineMode): string {
  const libraryHasNone = mode !== 'focus' && modePool(mode as TemplateMode, STRETCHES).length === 0;
  if (mode === 'warmup') {
    return libraryHasNone
      ? 'No warm-up movements in the library yet. Try Focused or Midday for now.'
      : 'Every warm-up movement needs equipment you left out. Tap a chip to allow it.';
  }
  if (libraryHasNone) return 'No stretches in the library suit this routine yet.';
  return 'Every stretch for this routine needs equipment you left out. Tap a chip to allow it.';
}

function Preview({
  routine,
  mode,
  excludedAny,
  onShuffle,
  onSave,
  onStart,
}: {
  routine: Routine;
  mode: RoutineMode;
  excludedAny: boolean;
  onShuffle: () => void;
  onSave: () => void;
  onStart: () => void;
}) {
  if (routine.steps.length === 0) {
    return (
      <p className="smode__empty text-amber" role="note">
        {emptyText(mode)}
      </p>
    );
  }
  const count = distinctStretchCount(routine);
  const dropped = routine.droppedAreas ?? [];
  const skipped = routine.skippedSlots ?? [];
  const noun = mode === 'warmup' ? 'movements' : 'stretches';
  return (
    <>
      <p className="stretch__summary label">
        {count} {noun} · {fmtClock(routine.totalSec)} · {routineDescription(routine, mode)}
      </p>
      {dropped.length > 0 && (
        <p className="stretch__dropped text-amber" role="note">
          Not enough time for: {dropped.map((a) => BODY_AREA_LABELS[a]).join(', ')}. Add minutes or
          pick fewer areas.
        </p>
      )}
      {skipped.length > 0 && (
        <p className="stretch__dropped text-amber" role="note">
          Nothing available for: {skipped.join(', ')}
          {excludedAny ? ' with the equipment left out.' : '.'}
        </p>
      )}
      <ol className="stretch__steps">
        {stepRuns(routine.steps).map((run) => {
          const s = getStretch(run.stretchId);
          if (!s) return null;
          const step = routine.steps[run.firstStep]!;
          const res = resolveStep(s, step);
          const tags = [run.bilateral ? 'L/R' : '', run.repOf > 1 ? `×${run.repOf}` : '']
            .filter(Boolean)
            .join(' ');
          const spoken = [
            run.bilateral ? 'each side' : '',
            run.repOf > 1 ? `${run.repOf} times` : '',
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <li key={run.firstStep} className="stretch__step">
              <StretchFigure pose={res.pose} className="stretch__thumb" />
              <span className="stretch__step-name">{s.name}</span>
              <span className="label stretch__side" aria-label={spoken || undefined}>
                {tags}
              </span>
              <span className="num stretch__step-sec">{run.holdSec}s</span>
            </li>
          );
        })}
      </ol>
      <div className="stretch__actions">
        <Button variant="ghost" onClick={onShuffle}>
          Shuffle
        </Button>
        <Button variant="ghost" onClick={onSave}>
          Save
        </Button>
        <Button variant="primary" block onClick={onStart}>
          Start
        </Button>
      </div>
    </>
  );
}
