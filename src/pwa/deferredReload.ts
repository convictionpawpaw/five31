/**
 * Safe reload after a service-worker update.
 *
 * vite-plugin-pwa in `autoUpdate` mode reloads the page as soon as a new
 * service worker activates, unless `onNeedReload` is supplied. Right after a
 * deploy that would kill a stretch routine mid-hold (its timer state lives in
 * memory) or yank the screen away mid-entry. Instead: reload now if no session
 * screen is open, otherwise wait until the route leaves the session screen.
 *
 * It deliberately does NOT reload on `visibilitychange: hidden`: backgrounding
 * the app to answer a message mid-routine must not cost the routine. The old
 * build keeps working until then (every asset is already loaded; the app makes
 * no network requests).
 */

/** Hash routes where an in-flight session lives in memory or mid-entry. */
const SESSION_HASH_PREFIXES = ['#/stretch/play', '#/workout/', '#/sl-session/'] as const;

/** Whether `hash` (e.g. `location.hash`) is an active-session screen. */
export function isActiveSessionHash(hash: string): boolean {
  return SESSION_HASH_PREFIXES.some((p) => {
    if (p.endsWith('/')) return hash.startsWith(p);
    // '#/stretch/play' itself, or with a query/sub-path, but not '#/stretch/playlist'.
    return hash === p || hash.startsWith(`${p}?`) || hash.startsWith(`${p}/`);
  });
}

/** The slice of `window` this needs (injectable for tests). */
export interface ReloadWindow {
  location: { hash: string; reload: () => void };
  addEventListener: (type: 'hashchange', fn: () => void) => void;
  removeEventListener: (type: 'hashchange', fn: () => void) => void;
}

/**
 * Reload when it is safe. Idempotent per window: a second call while a reload
 * is already pending does not stack listeners.
 */
export function reloadWhenSafe(win: ReloadWindow): void {
  const state = win as ReloadWindow & { __five31ReloadPending?: boolean };
  if (!isActiveSessionHash(win.location.hash)) {
    win.location.reload();
    return;
  }
  if (state.__five31ReloadPending) return;
  state.__five31ReloadPending = true;
  const onHashChange = () => {
    if (isActiveSessionHash(win.location.hash)) return;
    win.removeEventListener('hashchange', onHashChange);
    state.__five31ReloadPending = false;
    win.location.reload();
  };
  win.addEventListener('hashchange', onHashChange);
}
