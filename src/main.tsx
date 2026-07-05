import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Style + font layer — order matters: tokens (custom props) → fonts → base
// reset → effects. Feature/component CSS is imported by each module.
import './styles/tokens.css';
import './assets/fonts/fonts.css';
import './styles/base.css';
import './styles/effects.css';

import { initPersistence } from './pwa/persistence.ts';
import { seedDemoData } from './db/devSeed.ts';
import App from './App.tsx';

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
