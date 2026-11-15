/**
 * Backup sharing — the ONLY way a backup leaves the phone, so every outcome is
 * reported truthfully. Nothing here claims a file was saved unless the platform
 * said so.
 *
 * - 'shared': the OS share sheet resolved (the user picked a target).
 * - 'cancelled': the user dismissed the share sheet (AbortError). Nothing saved.
 * - 'download-attempted': an `<a download>` was clicked. The browser gives no
 *   confirmation, and in an iOS standalone PWA it is unreliable, so callers
 *   must say "started, check Files/Downloads", never "saved".
 * - 'needs-gesture': share() was refused because the transient user activation
 *   was lost (NotAllowedError; WebKit drops it across an `await`). The prepared
 *   file rides along so the UI can offer a button whose click handler calls
 *   {@link shareFileFromGesture} synchronously.
 * - 'failed': nothing could be attempted (or the attempt threw).
 */
export type ShareOutcome =
  | { kind: 'shared' }
  | { kind: 'cancelled' }
  | { kind: 'download-attempted' }
  | { kind: 'needs-gesture'; file: File }
  | { kind: 'failed'; message: string };

/** The slice of `navigator` the share logic uses (injectable for tests). */
export interface ShareNavigator {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
}

/** Everything platform-specific, so the decision logic is pure and testable. */
export interface ShareEnv {
  navigator: ShareNavigator | undefined;
  /** Start an `<a download>` for the file. Throws when not possible. */
  download: (file: File) => void;
}

/** The real browser environment. */
export function browserShareEnv(): ShareEnv {
  return {
    navigator: typeof navigator === 'undefined' ? undefined : (navigator as ShareNavigator),
    download: anchorDownload,
  };
}

/** Wrap backup JSON as a File ready for share() or download. */
export function prepareBackupFile(json: string, filename: string): File {
  return new File([json], filename, { type: 'application/json' });
}

function errorName(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'name' in err
    ? String((err as { name: unknown }).name)
    : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function canShareFile(nav: ShareNavigator | undefined, data: ShareData): boolean {
  if (!nav?.share || !nav.canShare) return false;
  try {
    return nav.canShare(data);
  } catch {
    return false;
  }
}

function tryDownload(file: File, env: ShareEnv): ShareOutcome {
  try {
    env.download(file);
    return { kind: 'download-attempted' };
  } catch (err) {
    return { kind: 'failed', message: errorMessage(err) };
  }
}

/**
 * Share a prepared backup file. Prefers the Web Share API (iOS share sheet →
 * Save to Files / AirDrop) and falls back to an `<a download>` only when share
 * is unavailable or fails for a reason OTHER than cancel / lost activation.
 *
 * Call this right after an `await` (e.g. after exportBackup()); if WebKit has
 * dropped the user activation the result is 'needs-gesture', NOT a silent
 * download fallback.
 */
export async function shareBackupFile(file: File, env: ShareEnv = browserShareEnv()): Promise<ShareOutcome> {
  const data: ShareData = { files: [file], title: file.name };
  if (canShareFile(env.navigator, data)) {
    try {
      await env.navigator!.share!(data);
      return { kind: 'shared' };
    } catch (err) {
      const name = errorName(err);
      if (name === 'AbortError') return { kind: 'cancelled' };
      if (name === 'NotAllowedError') return { kind: 'needs-gesture', file };
      // Any other share failure (DataError, TypeError…): try the download.
      return tryDownload(file, env);
    }
  }
  return tryDownload(file, env);
}

/**
 * The second attempt, from a fresh tap. MUST be called synchronously inside the
 * click handler (no `await` before it): the share() call below is the first
 * thing that runs, so it is still inside the user activation. If even this is
 * refused, fall back to the download rather than looping on the button.
 */
export function shareFileFromGesture(file: File, env: ShareEnv = browserShareEnv()): Promise<ShareOutcome> {
  const data: ShareData = { files: [file], title: file.name };
  if (!canShareFile(env.navigator, data)) return Promise.resolve(tryDownload(file, env));
  let pending: Promise<void>;
  try {
    pending = env.navigator!.share!(data); // synchronous call: activation intact
  } catch (err) {
    return Promise.resolve(
      errorName(err) === 'AbortError' ? { kind: 'cancelled' } : tryDownload(file, env),
    );
  }
  return pending.then(
    (): ShareOutcome => ({ kind: 'shared' }),
    (err: unknown): ShareOutcome =>
      errorName(err) === 'AbortError' ? { kind: 'cancelled' } : tryDownload(file, env),
  );
}

/** User-facing copy for an outcome. Never claims success it cannot know. */
export function describeShareOutcome(outcome: ShareOutcome): {
  text: string;
  tone: 'success' | 'info' | 'danger';
} {
  switch (outcome.kind) {
    case 'shared':
      return { text: 'Backup shared', tone: 'success' };
    case 'cancelled':
      return { text: 'Export cancelled: nothing was saved', tone: 'info' };
    case 'download-attempted':
      return {
        text: 'Download started. Check Files › Downloads to confirm the backup saved.',
        tone: 'info',
      };
    case 'needs-gesture':
      return { text: 'Backup ready: tap “Save backup” to finish', tone: 'info' };
    case 'failed':
      return { text: `Export failed: ${outcome.message}`, tone: 'danger' };
  }
}

/** Classic `<a download>` blob fallback. Throws without a DOM. */
function anchorDownload(file: File): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new Error('Downloads are not available here.');
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revocation: click() only QUEUES the download navigation; WebKit fails
  // to fetch an already-revoked blob URL if we revoke synchronously (classic
  // "WebKitBlobResource error 1"). FileSaver.js delays for the same reason.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Timestamped default backup filename using the LOCAL calendar date (the day
 * the user sees on their phone), e.g. `five31-backup-2026-07-05.json`.
 */
export function defaultBackupFilename(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `five31-backup-${y}-${m}-${d}.json`;
}
