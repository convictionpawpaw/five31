import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { WarmupLift } from '../../core/stretch/types.ts';
import { WARMUP_LIFT_LABELS } from '../../core/stretch/modes.ts';
import { computeStreak } from '../../core/stretch/streak.ts';
import { useToday } from './useToday.ts';
import { listStretchSessions } from '../../db/repo/index.ts';
import { streakStatus } from './stretchFormat.ts';
import { loadStretchPrefs } from './stretchPrefs.ts';
import type { StretchScreenState } from './StretchScreen.tsx';
import './stretch.css';
import './modes.css';

/**
 * Compact stretch streak for the Today screen: the count and whether today is
 * done, linking to /stretch. With a next lifting workout it also offers
 * "Warm up for {Lift}", which opens the Stretch screen with the Warm-up card
 * open and that lift selected (nothing starts by itself). Self-contained (its
 * own live query) so the lifting UI around it needs no changes.
 */
export function StretchTodayPanel({ warmupLift }: { warmupLift?: WarmupLift | null }) {
  const sessions = useLiveQuery(listStretchSessions, []);
  const today = useToday();
  const [warmupMinutes] = useState(() => loadStretchPrefs().modeMinutes.warmup);
  if (sessions === undefined) return null;
  const s = computeStreak(sessions, today);
  const status = streakStatus(s);
  const warmState: StretchScreenState | null = warmupLift
    ? { mode: 'warmup', lift: warmupLift }
    : null;
  return (
    <div className="hud-panel">
      <Link to="/stretch" className="stretch-today" aria-label="Open Stretch">
        <div className="hud-panel__title">Stretch</div>
        <div className="stretch-today__row">
          <span className={`num num-lg${s.doneToday ? ' text-amber' : ''}`}>{s.current}</span>
          <span className="label label-hi">Day streak</span>
          <span className={`label stretch-today__status streak__status--${status.tone}`}>
            {s.doneToday ? 'Done today' : 'Not yet today'}
          </span>
          <span className="stretch-today__go label text-cyan" aria-hidden="true">
            →
          </span>
        </div>
      </Link>
      {warmupLift && warmState && (
        <Link to="/stretch" state={warmState} className="stretch-today__warmup label">
          <span>
            Warm up for {WARMUP_LIFT_LABELS[warmupLift]} · {warmupMinutes} min
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  );
}
