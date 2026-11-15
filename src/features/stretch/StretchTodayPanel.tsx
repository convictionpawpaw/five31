import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { computeStreak } from '../../core/stretch/streak.ts';
import { useToday } from './useToday.ts';
import { listStretchSessions } from '../../db/repo/index.ts';
import { streakStatus } from './stretchFormat.ts';
import './stretch.css';

/**
 * Compact stretch streak for the Today screen: the count and whether today is
 * done. The whole panel links to /stretch. Self-contained (its own live
 * query) so the lifting UI around it needs no changes.
 */
export function StretchTodayPanel() {
  const sessions = useLiveQuery(listStretchSessions, []);
  const today = useToday();
  if (sessions === undefined) return null;
  const s = computeStreak(sessions, today);
  const status = streakStatus(s);
  return (
    <Link to="/stretch" className="hud-panel stretch-today" aria-label="Open Stretch">
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
  );
}
