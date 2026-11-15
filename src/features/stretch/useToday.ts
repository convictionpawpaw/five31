import { useEffect, useState } from 'react';
import { localIsoDate } from '../../core/localDate.ts';

/** Ms from `now` until just after the next local midnight. */
export function msUntilNextLocalDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

/**
 * The local calendar day (`YYYY-MM-DD`), kept current: refreshed when the
 * page becomes visible or regains focus (an installed PWA can sit suspended
 * for days) and by a timer set for the next local midnight.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => localIsoDate());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      setToday(localIsoDate());
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(refresh, msUntilNextLocalDay(new Date()));
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', refresh);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  return today;
}
