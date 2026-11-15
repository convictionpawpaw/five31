import { db } from '../../db/db.ts';

/** How long a reset may wait on `db.delete()` before reporting it stuck. */
export const DELETE_TIMEOUT_MS = 10_000;

/** Thrown when the delete did not finish in time (typically blocked). */
export class DeleteTimeoutError extends Error {
  constructor() {
    super(
      'The reset did not finish: the database is busy, usually because another FIVE31 window is open. Close it, reload, and try again.',
    );
    this.name = 'DeleteTimeoutError';
  }
}

export interface DeleteDeps {
  deleteDb: () => Promise<void>;
  reload: () => void;
  timeoutMs: number;
}

const defaultDeps: DeleteDeps = {
  deleteDb: () => db.delete(),
  reload: () => {
    if (typeof location !== 'undefined') location.reload();
  },
  timeoutMs: DELETE_TIMEOUT_MS,
};

/**
 * FULL RESET — delete the whole IndexedDB database (not just clear tables, so a
 * corrupt schema can't survive a reset) and reload the app so it boots back
 * into onboarding. Lives INSIDE the settings feature (not src/db) because it is
 * a destructive UI affordance, not part of the persistence contract.
 *
 * Rejects (and does NOT reload) when the delete fails, or when it has not
 * finished within `timeoutMs` (an IndexedDB delete is held open indefinitely
 * while another connection is "blocked"), so the caller can re-enable its UI
 * and show the reason. Resolves only after a successful delete has triggered
 * the reload.
 */
export async function deleteEverything(deps: Partial<DeleteDeps> = {}): Promise<void> {
  const { deleteDb, reload, timeoutMs } = { ...defaultDeps, ...deps };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeleteTimeoutError()), timeoutMs);
  });
  const deletion = deleteDb();
  try {
    await Promise.race([deletion, timeout]);
  } catch (err) {
    if (err instanceof DeleteTimeoutError) {
      // A blocked delete stays queued and may still complete once the other
      // connection closes. The data is then gone and this page's db handle is
      // closed, so reload into onboarding rather than leave a broken screen.
      deletion.then(reload, () => undefined);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  reload();
}
