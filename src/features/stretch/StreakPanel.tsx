import type { StreakSummary } from '../../core/stretch/streak.ts';
import { HudPanel } from '../../components/index.ts';
import { streakStatus } from './stretchFormat.ts';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * The streak HUD: current streak large, today's state, lifetime stats and a
 * five-week dot calendar (Monday-first, today ringed, future days blank).
 */
/** Screen-reader summary of the dot calendar (the dots carry no text). */
function calendarLabel(summary: StreakSummary): string {
  const past = summary.calendar.filter((d) => !d.isFuture);
  const done = past.filter((d) => d.count > 0).length;
  const today = summary.doneToday ? 'done today' : 'not yet today';
  return `Last 5 weeks: stretched on ${done} of ${past.length} days, ${today}`;
}

export function StreakPanel({ summary }: { summary: StreakSummary }) {
  const status = streakStatus(summary);
  return (
    <HudPanel title="Streak" active={summary.doneToday} className="streak">
      <div className="streak__hero">
        <span className={`num streak__num${summary.doneToday ? ' text-amber' : ''}`}>
          {summary.current}
        </span>
        <div className="streak__hero-copy">
          <span className="label label-hi">Day streak</span>
          <span className={`label streak__status streak__status--${status.tone}`}>
            {status.text}
          </span>
        </div>
      </div>

      <dl className="streak__stats">
        <div>
          <dt className="label">Longest</dt>
          <dd className="num num-md">{summary.longest}</dd>
        </div>
        <div>
          <dt className="label">Sessions</dt>
          <dd className="num num-md">{summary.totalSessions}</dd>
        </div>
        <div>
          <dt className="label">Minutes</dt>
          <dd className="num num-md">{summary.totalMinutes}</dd>
        </div>
        <div>
          <dt className="label">This week</dt>
          <dd className="num num-md">{summary.sessionsThisWeek}</dd>
        </div>
      </dl>

      <div className="streak__cal" role="img" aria-label={calendarLabel(summary)}>
        {WEEKDAYS.map((d, i) => (
          <span key={`h${i}`} className="streak__cal-head label">
            {d}
          </span>
        ))}
        {summary.calendar.map((day) => (
          <span
            key={day.date}
            title={day.date}
            className={[
              'streak__dot',
              day.count > 0 ? 'is-done' : '',
              day.isToday ? 'is-today' : '',
              day.isFuture ? 'is-future' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          />
        ))}
      </div>
    </HudPanel>
  );
}
