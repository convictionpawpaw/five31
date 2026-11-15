import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Settings } from './core/types.ts';
import { getSettings } from './db/repo/index.ts';
import { ErrorScreen } from './components/ErrorScreen.tsx';

/** How long the boot splash may sit on an unresolved settings read. */
const OPEN_TIMEOUT_MS = 10_000;

type GateRead = { settings: Settings | null } | { error: unknown };

/**
 * Wrap the settings read so we can distinguish four states from useLiveQuery's
 * single `undefined`-while-loading value:
 *  - undefined         → query still loading
 *  - { settings: null }→ loaded, no settings row (onboarding never run)
 *  - { settings: S }   → loaded, row present
 *  - { error }         → the read (or db.open()) FAILED; surfaced, never hidden
 */
async function readSettings(): Promise<GateRead> {
  try {
    const s = await getSettings();
    return { settings: s ?? null };
  } catch (error) {
    return { error };
  }
}

/**
 * Guards the tab-shell routes. Reactively reads the singleton Settings row:
 *  - while the query is resolving → minimal splash (for at most OPEN_TIMEOUT_MS;
 *    a blocked or hung db.open() then shows the error screen, which can still
 *    try an export)
 *  - the read failed → the app error screen
 *  - no settings OR onboarding incomplete → redirect to /onboarding
 *  - otherwise → render the requested route (<Outlet />)
 *
 * Lives inside the router so it can use useNavigate; wraps the AppLayout branch.
 */
export function SettingsGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const [timedOut, setTimedOut] = useState(false);

  const result = useLiveQuery(() => readSettings(), []);
  const loading = result === undefined;
  const failed = result !== undefined && 'error' in result;
  const needsOnboarding =
    result !== undefined &&
    'settings' in result &&
    (result.settings === null || !result.settings.onboardingComplete);

  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setTimedOut(true), OPEN_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [loading]);

  useEffect(() => {
    if (needsOnboarding && location.pathname !== '/onboarding') {
      navigate('/onboarding', { replace: true });
    }
  }, [needsOnboarding, location.pathname, navigate]);

  if (failed) {
    return <ErrorScreen error={result.error} />;
  }

  if (loading) {
    if (timedOut) {
      return (
        <ErrorScreen
          error={
            new Error(
              'The database did not open. Another FIVE31 window may be holding it: close it, then reload.',
            )
          }
        />
      );
    }
    return (
      <div className="splash">
        <span className="splash__brand num">FIVE31</span>
      </div>
    );
  }

  if (needsOnboarding) {
    // Redirect effect is in flight; render nothing to avoid a flash of content.
    return null;
  }

  return <Outlet />;
}
