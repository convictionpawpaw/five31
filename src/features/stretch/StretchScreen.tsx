import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BODY_AREAS,
  BODY_AREA_LABELS,
  type BodyArea,
  type Routine,
} from '../../core/stretch/types.ts';
import { generateRoutine, MAX_MINUTES, MIN_MINUTES } from '../../core/stretch/generator.ts';
import { getStretch } from '../../core/stretch/library.ts';
import { matchAreas } from '../../core/stretch/matchAreas.ts';
import { computeStreak } from '../../core/stretch/streak.ts';
import { listStretchSessions, recentStretchIds } from '../../db/repo/index.ts';
import { Button, HudPanel } from '../../components/index.ts';
import { StretchFigure } from './StretchFigure.tsx';
import { StreakPanel } from './StreakPanel.tsx';
import { loadStretchPrefs, saveStretchPrefs } from './stretchPrefs.ts';
import { unlockAudio } from './stretchAudio.ts';
import { armAutostart } from './playerLaunch.ts';
import { useToday } from './useToday.ts';
import { fmtClock } from './stretchFormat.ts';
import './stretch.css';

/** One-tap preset for the owner's main aim: daily neck and back work. */
const NECK_BACK_CHEST: BodyArea[] = ['neck', 'upperBack', 'lowerBack', 'chest'];
const DURATIONS = Array.from({ length: MAX_MINUTES - MIN_MINUTES + 1 }, (_, i) => MIN_MINUTES + i);

function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

async function readStretch() {
  const [sessions, recent] = await Promise.all([listStretchSessions(), recentStretchIds()]);
  return { sessions, recent };
}

/** Router state handed to the player. */
export interface StretchPlayState {
  routine: Routine;
}

/**
 * Stretch home: streak HUD, routine builder (duration, focus chips, free-text
 * matching, presets), a preview of the generated routine and Start.
 */
export function StretchScreen() {
  const navigate = useNavigate();
  const data = useLiveQuery(readStretch, []);
  const [prefs] = useState(loadStretchPrefs);
  const [minutes, setMinutes] = useState(prefs.minutes);
  const [focus, setFocus] = useState<BodyArea[]>(prefs.focusAreas);
  const [seed, setSeed] = useState(randomSeed);
  const [text, setText] = useState('');
  const [matchMsg, setMatchMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const recent = data?.recent;
  const routine = useMemo(
    () =>
      recent === undefined
        ? null
        : generateRoutine({ minutes, focusAreas: focus, seed, recentStretchIds: recent }),
    [minutes, focus, seed, recent],
  );

  const today = useToday();
  const streak = useMemo(() => (data ? computeStreak(data.sessions, today) : null), [data, today]);
  // Areas the generator could not fit in the chosen time. Optional on Routine,
  // so read defensively.
  const dropped: BodyArea[] =
    (routine as (Routine & { droppedAreas?: BodyArea[] }) | null)?.droppedAreas ?? [];

  const chooseMinutes = (m: number) => {
    setMinutes(m);
    saveStretchPrefs({ minutes: m });
  };
  const chooseFocus = (areas: BodyArea[]) => {
    const ordered = BODY_AREAS.filter((a) => areas.includes(a));
    setFocus(ordered);
    saveStretchPrefs({ focusAreas: ordered });
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

  const start = () => {
    if (!routine) return;
    // Created inside the tap so iOS allows the player's audio cues.
    unlockAudio();
    // One-shot token: the player auto-starts only when mounted from this tap.
    armAutostart();
    const state: StretchPlayState = { routine };
    navigate('/stretch/play', { state });
  };

  const presetActive =
    focus.length === NECK_BACK_CHEST.length && NECK_BACK_CHEST.every((a) => focus.includes(a));
  const stretchCount = routine ? new Set(routine.steps.map((s) => s.stretchId)).size : 0;

  return (
    <div className="stretch safe-top">
      <header className="stretch__head">
        <h1 className="stretch__title label label-hi">Stretch</h1>
        <Link to="/stretch/gallery" className="stretch__link label">
          All stretches →
        </Link>
      </header>

      {streak ? (
        <StreakPanel summary={streak} />
      ) : (
        <HudPanel title="Streak">
          <p className="label text-low">Loading…</p>
        </HudPanel>
      )}

      <HudPanel title="Build a routine" className="stretch__builder">
        <div className="stretch__field">
          <span className="label">Minutes</span>
          <div className="stretch__durations" role="group" aria-label="Duration">
            {DURATIONS.map((m) => (
              <button
                key={m}
                type="button"
                className={`stretch__seg num${m === minutes ? ' is-on' : ''}`}
                aria-pressed={m === minutes}
                onClick={() => chooseMinutes(m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

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

        <div className="stretch__field">
          <span className="label">Focus</span>
          <div className="stretch__chips">
            <button
              type="button"
              className={`stretch__chip${focus.length === 0 ? ' is-on' : ''}`}
              aria-pressed={focus.length === 0}
              onClick={() => {
                chooseFocus([]);
                setMatchMsg(null);
              }}
            >
              Well-rounded
            </button>
            <button
              type="button"
              className={`stretch__chip stretch__chip--preset${presetActive ? ' is-on' : ''}`}
              aria-pressed={presetActive}
              onClick={() => {
                chooseFocus(NECK_BACK_CHEST);
                setMatchMsg(null);
              }}
            >
              Neck + back + chest
            </button>
            {BODY_AREAS.map((a) => (
              <button
                key={a}
                type="button"
                className={`stretch__chip${focus.includes(a) ? ' is-on' : ''}`}
                aria-pressed={focus.includes(a)}
                onClick={() => toggleArea(a)}
              >
                {BODY_AREA_LABELS[a]}
              </button>
            ))}
          </div>
        </div>
      </HudPanel>

      <HudPanel title="Routine" active className="stretch__preview">
        {routine ? (
          <>
            <p className="stretch__summary label">
              {stretchCount} stretches · {fmtClock(routine.totalSec)} ·{' '}
              {routine.focusAreas.length === 0
                ? 'Well-rounded'
                : routine.focusAreas.map((a) => BODY_AREA_LABELS[a]).join(', ')}
            </p>
            {dropped.length > 0 && (
              <p className="stretch__dropped text-amber" role="note">
                Not enough time for: {dropped.map((a) => BODY_AREA_LABELS[a]).join(', ')}. Add
                minutes or pick fewer areas.
              </p>
            )}
            <ol className="stretch__steps">
              {routine.steps.map((st, i) => {
                const s = getStretch(st.stretchId);
                if (!s) return null;
                return (
                  <li key={i} className="stretch__step">
                    <StretchFigure
                      pose={s.pose}
                      mirrored={st.side === 'right'}
                      className="stretch__thumb"
                    />
                    <span className="stretch__step-name">{s.name}</span>
                    {st.side && <span className="label stretch__side">{st.side}</span>}
                    <span className="num stretch__step-sec">{st.holdSec}s</span>
                  </li>
                );
              })}
            </ol>
            <div className="stretch__actions">
              <Button variant="ghost" onClick={() => setSeed(randomSeed())}>
                Shuffle
              </Button>
              <Button variant="primary" block onClick={start}>
                Start
              </Button>
            </div>
          </>
        ) : (
          <p className="label text-low">Loading…</p>
        )}
      </HudPanel>

      <p className="stretch__disclaimer">
        General flexibility guidance, not medical advice. Stop any stretch that causes pain.
      </p>
    </div>
  );
}
