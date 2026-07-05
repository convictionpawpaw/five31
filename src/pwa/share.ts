/**
 * The result of a share attempt, so callers can toast the right message.
 * - 'shared': handed to the OS share sheet.
 * - 'downloaded': fell back to an <a download> blob.
 * - 'unsupported': no browser environment (SSR/test) — nothing happened.
 */
export type ShareResult = 'shared' | 'downloaded' | 'unsupported';

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
      // User cancel (AbortError) → do NOT fall back to a download.
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
      // Any other share failure falls through to the download path.
    }
  }

  // Fallback: trigger a download.
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return 'downloaded';
}

/** Build a timestamped default backup filename, e.g. `five31-backup-2026-07-05.json`. */
export function defaultBackupFilename(date = new Date()): string {
  const iso = date.toISOString().slice(0, 10);
  return `five31-backup-${iso}.json`;
}
