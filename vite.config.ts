/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  base: '/five31/',
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
        start_url: '/five31/',
        scope: '/five31/',
        background_color: '#060a0b',
        theme_color: '#060a0b',
        icons: [
          {
            src: '/five31/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/five31/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/five31/icons/icon-maskable-512.png',
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
        navigateFallback: '/five31/index.html',
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
