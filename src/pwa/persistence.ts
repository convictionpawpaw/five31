/**
 * Request that the browser make this origin's storage PERSISTENT (not evictable
 * under storage pressure). Safe to call anywhere: guarded for SSR / test / older
 * browsers where the API is absent. Returns whether storage is persisted (false
 * if unsupported or denied).
 */
export async function initPersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  const storage = navigator.storage;
  if (!storage) return false;

  // Already persisted? Don't re-prompt.
  if (typeof storage.persisted === 'function') {
    try {
      if (await storage.persisted()) return true;
    } catch {
      // fall through to persist()
    }
  }

  if (typeof storage.persist !== 'function') return false;
  try {
    return await storage.persist();
  } catch {
    return false;
  }
}

/** A best-effort read of storage usage, or null when unsupported. */
export interface StorageEstimate {
  usage: number;
  quota: number;
  /** Fraction of quota used in [0,1], or null when quota is unknown/zero. */
  percentUsed: number | null;
}

/**
 * Report current storage usage/quota. Returns null when the StorageManager
 * estimate API is unavailable (SSR / test / unsupported browser).
 */
export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (typeof navigator === 'undefined') return null;
  const storage = navigator.storage;
  if (!storage || typeof storage.estimate !== 'function') return null;

  try {
    const est = await storage.estimate();
    const usage = est.usage ?? 0;
    const quota = est.quota ?? 0;
    const percentUsed = quota > 0 ? usage / quota : null;
    return { usage, quota, percentUsed };
  } catch {
    return null;
  }
}
