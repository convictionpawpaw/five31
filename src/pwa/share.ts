/**
 * The result of a share attempt, so callers can toast the right message.
 * - 'shared': handed to the OS share sheet AND accepted by the user.
 * - 'downloaded': fell back to an <a download> blob.
 * - 'cancelled': the user dismissed the share sheet without picking a target
 *   (no file was saved) — callers must NOT report success.
 * - 'unsupported': no browser environment (SSR/test) — nothing happened.
 */
export type ShareResult = 'shared' | 'downloaded' | 'cancelled' | 'unsupported';

/**
 * Share a backup JSON string. Prefers the Web Share API with a file attachment
 * (iOS share sheet → Files/AirDrop/etc.) when `navigator.canShare` approves,
 * otherwise falls back to a classic `<a download>` blob. Guarded for non-browser
 * environments (returns 'unsupported').
 */
export async function shareBackup(json: string, filename: string): Promise<ShareResult> {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') {
    return 'unsupported';
  }

  const blob = new Blob([json], { type: 'application/json' });

  // Preferred path: native share sheet with a file.
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
    share?: (data?: ShareData) => Promise<void>;
  };
  if (typeof File === 'function' && nav.share && nav.canShare) {
    const file = new File([blob], filename, { type: 'application/json' });
    const shareData: ShareData = { files: [file], title: filename };
    try {
      if (nav.canShare(shareData)) {
        await nav.share(shareData);
        return 'shared';
      }
    } catch (err) {
      // User cancel (AbortError): report 'cancelled' (no file was saved) and do
      // NOT fall back to a download — the user deliberately backed out.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Any other share failure falls through to the download path.
    }
  }

  // Fallback: trigger a download.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revocation: click() only QUEUES the download navigation; WebKit fails
  // to fetch an already-revoked blob URL if we revoke synchronously (classic
  // "WebKitBlobResource error 1"). FileSaver.js delays for the same reason.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}

/** Build a timestamped default backup filename, e.g. `five31-backup-2026-07-05.json`. */
export function defaultBackupFilename(date = new Date()): string {
  const iso = date.toISOString().slice(0, 10);
  return `five31-backup-${iso}.json`;
}
