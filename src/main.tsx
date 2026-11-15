import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Style + font layer — order matters: tokens (custom props) → fonts → base
// reset → effects. Feature/component CSS is imported by each module.
import './styles/tokens.css';
import './assets/fonts/fonts.css';
import './styles/base.css';
import './styles/effects.css';

import { registerSW } from 'virtual:pwa-register';
import { initPersistence } from './pwa/persistence.ts';
import { reloadWhenSafe } from './pwa/deferredReload.ts';
import { seedDemoData } from './db/devSeed.ts';
import App from './App.tsx';

// Register the service worker (autoUpdate). Everything is precached, so this
// simply makes the app installable + fully offline. `immediate` registers on
// startup rather than on window load. In autoUpdate mode the plugin would call
// window.location.reload() the moment a new worker activates; `onNeedReload`
// replaces that so a deploy never kills an in-flight stretch routine, workout
// or StrongLifts session: the reload waits until the route leaves it.
registerSW({ immediate: true, onNeedReload: () => reloadWhenSafe(window) });

// Ask the browser to make storage persistent (best-effort; safe if unsupported).
void initPersistence();

// Dev-only console helper: `window.__five31.seedDemoData(12)` to stress charts.
declare global {
  interface Window {
    __five31?: { seedDemoData: (cycleCount: number) => Promise<void> };
  }
}
if (import.meta.env.DEV) {
  window.__five31 = { seedDemoData };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
