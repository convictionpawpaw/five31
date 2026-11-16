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

The default Vite `base` is `/five31/`, so the app is served from a repo named `five31`.

1. Create a **public** GitHub repo named `five31` (Pages is free only on public repos).
2. Push this project. The deploy workflow triggers on a push to **either** `main`
   or `master`, so whatever your local default branch is, the first push deploys.
   (Check yours with `git branch --show-current`. If you prefer `main`, rename
   first: `git branch -m master main`.)
3. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. The `.github/workflows/deploy.yml` workflow runs on every push to `main`/`master`
   (`npm ci → lint → test → build → deploy`), and can also be run manually from the
   **Actions** tab (workflow_dispatch). When it finishes, the app is live at:

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
[Netlify Drop](https://app.netlify.com/drop), which serves from the domain root.

The deploy base is **env-driven** (`FIVE31_BASE`, default `/five31/`), and every
base-relative URL — manifest icons, `start_url`/`scope`, the service-worker
`navigateFallback`, and the `index.html` icon links (via `%BASE_URL%`) — is
derived from it. So a root-hosted build is a one-variable change; do **not** just
edit `base` by hand (that would leave stale `/five31/` paths in the manifest and
SW and break offline support):

```bash
FIVE31_BASE=/ npm run build   # PowerShell: $env:FIVE31_BASE='/'; npm run build
```

Then drag the `dist/` folder onto Netlify Drop. Everything (icons, Add-to-Home-
Screen, and the offline service worker) resolves against `/`. Omit the variable
to go back to a `/five31/` GitHub Pages build — no file edits needed.

## Stretch

The **Stretch** tab builds guided 5 to 10 minute stretching routines. Pick a
length, then either tap body areas, describe what feels tight in plain words
("stiff neck, low back"), or leave it well-rounded. The words are matched to
areas entirely on-device by a synonym table (`src/core/stretch/matchAreas.ts`);
nothing is sent anywhere. Routines are drawn from the stretch library in
`src/core/stretch/library.ts`: about three quarters of the time goes to the
chosen areas and the rest to complementary ones, ordered standing, chair,
kneeling, floor so you change position as little as possible. Shuffle gives a
different routine for the same choices.

**Repeats** (1x / 2x / 3x, default 2x, remembered per device) sets how many
times each stretch is held, back to back: a one-sided stretch is hold, hold; a
two-sided one is left, right, left, right. Coverage comes first (every chosen
area still gets its stretch), then the spare time goes on repeats before any
further new stretch, so a 2x routine has fewer different stretches, most of
them done twice. Cat-cow is already a set of slow repetitions and is never
repeated. The player shows "Rep 2 of 2" and says "Again" or "Switch sides"
between reps of the same stretch.

**Saved routines:** Save on the routine preview (or "Save this routine" after a
session) keeps that exact routine under a name. The Saved routines list on the
Stretch screen starts, renames or deletes one; a saved routine plays exactly as
it was saved, and counts toward the streak like any other session.

The player shows a stick-figure illustration (amber marks where you should feel
it), a countdown with sound and vibration cues, and keeps the screen awake. A
session counts once you have stretched at least half its planned time; ending
earlier does not save it. The streak is strict: one counted session per local
calendar day, and a missed day resets it to zero. Every illustration is on the
gallery page at `#/stretch/gallery` ("All stretches" on the Stretch screen).
Stretch sessions and saved routines are included in backups (backup schema v3;
older backups still import and keep what they predate, see below). This is general
flexibility guidance, not medical advice.

## Backup and restore

- **Export** (Settings → Export Backup) opens the iOS share sheet; pick
  **Save to Files**. If iOS refuses the sheet because the tap "expired" while the
  backup was being prepared, the button turns into **Backup ready: tap to save**;
  tap it to open the sheet. Where the share sheet is unavailable the app falls
  back to a browser download and says only that the download *started*: check
  Files › Downloads to confirm it actually saved. Cancelling the sheet saves
  nothing and says so. Backup files are named with your local date
  (`five31-backup-YYYY-MM-DD.json`).
- **Import** replaces all training data in one all-or-nothing step, after the
  whole file has been checked: header, schema version (an integer from 1 up to
  the app's), and every row of every table. A malformed file is rejected with
  the table and row named, and nothing on the device changes. A file with
  training data but no settings row is rejected.
- **Stretch history on import:** a v2 or later backup replaces the stretch log
  with the backup's sessions. A **v1 backup predates stretching, so your current
  stretch log and streak are kept**. The confirmation dialog says which will
  happen.
- **Saved routines on import:** a v3 backup replaces your saved routines with
  the backup's. A **v1 or v2 backup predates saved routines, so the ones on this
  device are kept**. The confirmation dialog says this too.
- **If a screen crashes**, the app shows an error screen instead of a dead end.
  It offers **Export Backup** (works without any other screen rendering),
  **Reload**, and a link to Settings. Your data stays in IndexedDB either way.
- **Full Reset** (Settings → Danger) deletes cycles, workouts, accessories,
  bodyweight, stretch sessions, saved routines and settings. If the delete is blocked (usually
  another FIVE31 window is open) it stops after a few seconds and says so.
- App updates install in the background. The reload that applies an update
  waits until you leave a stretch routine, workout, or StrongLifts session.

## Notes

- Zero network requests after install — every asset (JS, CSS, fonts, icons) is
  precached by the service worker, so the app is fully usable offline.
- The repo holds only application code and generated icons. Your training data
  never leaves your device.
