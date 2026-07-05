import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Settings } from './core/types.ts';
import { getSettings } from './db/repo/index.ts';

/**
 * Wrap the settings read so we can distinguish three states from useLiveQuery's
 * single `undefined`-while-loading value:
 *  - undefined         → query still loading
 *  - { settings: null }→ loaded, no settings row (onboarding never run)
 *  - { settings: S }   → loaded, row present
 */
async function readSettings(): Promise<{ settings: Settings | null }> {
  const s = await getSettings();
  return { settings: s ?? null };
}

/**
 * Guards the tab-shell routes. Reactively reads the singleton Settings row:
 *  - while the query is resolving → minimal splash
 *  - no settings OR onboarding incomplete → redirect to /onboarding
 *  - otherwise → render the requested route (<Outlet />)
 *
 * Lives inside the router so it can use useNavigate; wraps the AppLayout branch.
 */
export function SettingsGate() {
  const navigate = useNavigate();
  const location = useLocation();

  const result = useLiveQuery(() => readSettings(), []);
  const loading = result === undefined;
  const needsOnboarding = !loading && (result.settings === null || !result.settings.onboardingComplete);

  useEffect(() => {
    if (needsOnboarding && location.pathname !== '/onboarding') {
      navigate('/onboarding', { replace: true });
    }
  }, [needsOnboarding, location.pathname, navigate]);

  if (loading) {
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
