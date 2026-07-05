/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  base: '/five31/',
  plugins: [react()],
  test: {
    // Core engine tests are pure; node environment is sufficient.
    // The jsdom/PWA setup arrives in later chunks.
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
