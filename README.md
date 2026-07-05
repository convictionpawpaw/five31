# FIVE31

A personal, single-user **5/3/1 workout log** — an installable, offline-first
PWA styled after the neon-noir HUDs of *Blade Runner 2049*. It auto-calculates
every set weight from your Training Maxes, auto-progresses TMs across unlimited
cycles, tracks AMRAP e1RM / PRs / bodyweight, and runs entirely on-device.

**All workout data lives in the browser's IndexedDB on your phone.** Nothing is
sent to a server and the repository never contains any personal data. Use
**Settings → Export Backup** regularly to save a JSON snapshot you can re-import.

## Dev commands

```bash
npm run dev       # local dev server (http://localhost:5173/five31/)
npm test          # vitest (watch);  npm test -- --run  for a single pass
npm run build     # type-check + production build to dist/
npm run preview   # serve the built dist/ (http://localhost:4173/five31/)
npm run icons     # regenerate app icons from src/assets/icon.svg (sharp)
```

## First-time deploy (GitHub Pages)

The Vite `base` is `/five31/`, so the app is served from a repo named `five31`.

1. Create a **public** GitHub repo named `five31` (Pages is free only on public repos).
2. Push this project to its `main` branch.
3. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. The `.github/workflows/deploy.yml` workflow runs on every push to `main`
   (`npm ci → test → build → deploy`). When it finishes, the app is live at:

   ```
   https://<your-username>.github.io/five31/
   ```

## Install on iPhone

1. Open the live URL in **Safari** (not an in-app browser).
2. Tap the **Share** button → **Add to Home Screen**.
3. Launch it from the home screen — it opens standalone (no browser chrome),
   works fully offline, and stores everything on-device.
4. Because data lives only in this browser's storage, **export a backup
   periodically** (Settings → Export Backup) and keep the file somewhere safe.

## Netlify Drop fallback

If you'd rather not use GitHub Pages, you can drag-and-drop the build to
[Netlify Drop](https://app.netlify.com/drop):

1. In `vite.config.ts`, change `base: '/five31/'` to `base: '/'`.
2. `npm run build`.
3. Drag the `dist/` folder onto Netlify Drop.

(Remember to revert `base` back to `/five31/` if you go back to GitHub Pages.)

## Notes

- Zero network requests after install — every asset (JS, CSS, fonts, icons) is
  precached by the service worker, so the app is fully usable offline.
- The repo holds only application code and generated icons. Your training data
  never leaves your device.
