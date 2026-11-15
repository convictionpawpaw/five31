import { useState } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { exportAndShareBackup } from '../pwa/exportFlow.ts';
import { describeShareOutcome, shareFileFromGesture, type ShareOutcome } from '../pwa/share.ts';
import './Button.css'; // the .btn classes, without depending on the Button component
import './ErrorScreen.css';

/** Best-effort, never-throwing message extraction for any thrown value. */
function messageOf(error: unknown): string {
  try {
    if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`.trim();
    if (error instanceof Error) return error.message || error.name;
    if (typeof error === 'string') return error;
    return JSON.stringify(error) ?? 'Unknown error';
  } catch {
    return 'Unknown error';
  }
}

/**
 * Export control usable from ANY screen, including the error screen: it calls
 * the export/share code directly (no live queries, no toast context) and shows
 * its own result. When the share sheet refuses because the tap's user
 * activation was lost across the DB read, it offers a "Save backup" button that
 * re-shares the already-prepared file synchronously from the new tap.
 */
export function BackupExportControl({
  onResult,
  label = 'Export Backup',
}: {
  onResult?: (outcome: ShareOutcome) => void;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [readyFile, setReadyFile] = useState<File | null>(null);
  const [status, setStatus] = useState<{ text: string; tone: string } | null>(null);

  const report = (outcome: ShareOutcome) => {
    setReadyFile(outcome.kind === 'needs-gesture' ? outcome.file : null);
    setStatus(describeShareOutcome(outcome));
    try {
      onResult?.(outcome);
    } catch {
      // A broken callback must not hide the inline result.
    }
  };

  const doExport = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      report(await exportAndShareBackup());
    } catch (err) {
      report({ kind: 'failed', message: messageOf(err) });
    } finally {
      setBusy(false);
    }
  };

  const saveReady = () => {
    if (!readyFile || busy) return;
    // NO await before this call: share() must run inside this tap's activation.
    const pending = shareFileFromGesture(readyFile);
    setBusy(true);
    pending
      .then(report, (err: unknown) => report({ kind: 'failed', message: messageOf(err) }))
      .finally(() => setBusy(false));
  };

  return (
    <div className="backup-export">
      {readyFile ? (
        <button type="button" className="btn btn--primary btn--block" onClick={saveReady} disabled={busy}>
          Backup ready: tap to save
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => void doExport()}
          disabled={busy}
        >
          {busy ? 'Preparing backup…' : label}
        </button>
      )}
      {status && (
        <p role="status" className={`label backup-export__status backup-export__status--${status.tone}`}>
          {status.text}
        </p>
      )}
    </div>
  );
}

/**
 * App-styled fallback for any render or data error. Deliberately depends on
 * nothing that can itself fail to render (no live queries, no toast context, no
 * router hooks): Reload, Export Backup, and a plain hash link to Settings.
 */
export function ErrorScreen({ error }: { error: unknown }) {
  const message = messageOf(error);
  return (
    <div className="error-screen safe-top" role="alert">
      <h1 className="error-screen__title num">Something broke</h1>
      <p className="label text-mid error-screen__copy">
        Your data is still stored on this device. Export a backup before trying anything else.
      </p>
      <pre className="error-screen__message">{message}</pre>
      <div className="error-screen__actions">
        <BackupExportControl />
        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={() => {
            if (typeof location !== 'undefined') location.reload();
          }}
        >
          Reload
        </button>
        {/* A plain hash link: works even if the router state is what broke. */}
        <a className="btn btn--ghost btn--block error-screen__link" href="#/settings">
          Open Settings
        </a>
      </div>
    </div>
  );
}

/** `errorElement` for the top-level routes. */
export function RouteErrorScreen() {
  const error = useRouteError();
  return <ErrorScreen error={error} />;
}
