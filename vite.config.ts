/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Deploy base is env-driven so the SAME build config works on GitHub Pages
// (default `/five31/`) and at a domain root (Netlify Drop: FIVE31_BASE=/).
// Every base-relative URL below is derived from `base` — icons, start_url,
// scope, and the SW navigateFallback — so changing the base needs no other edit
// and never leaves a stale `/five31/` path that would 404 or break the SW.
// Read the env var without depending on @types/node (not installed): narrow the
// Node process global off globalThis with a minimal inline shape.
const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env;
const base = nodeEnv?.FIVE31_BASE ?? '/five31/';

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // App makes zero network requests; the SW simply swaps in the new
      // precache on the next load. autoUpdate = no user prompt needed.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'FIVE31',
        short_name: '531',
        description: '5/3/1 training log',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        background_color: '#060a0b',
        theme_color: '#060a0b',
        icons: [
          {
            src: `${base}icons/icon-192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `${base}icons/icon-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `${base}icons/icon-maskable-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache everything the app ships — fonts included — so it runs
        // fully offline with no runtime caching. No network fetches at runtime.
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
        navigateFallback: `${base}index.html`,
      },
    }),
  ],
  test: {
    // Core engine tests are pure; node environment is sufficient.
    // The jsdom/PWA setup arrives in later chunks.
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
