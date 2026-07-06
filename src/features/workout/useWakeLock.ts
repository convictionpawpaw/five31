import { useEffect, useRef } from 'react';

/**
 * Hold a `navigator.wakeLock('screen')` sentinel while `active` is true so the
 * phone screen doesn't sleep mid-workout. Re-acquires when the tab returns to
 * the foreground (the OS drops the lock on visibility change), and releases on
 * unmount / when `active` goes false. Silently no-ops where the API is missing.
 */
export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & { wakeLock?: WakeLock };
    if (!nav.wakeLock) return;

    let cancelled = false;

    const acquire = async (): Promise<void> => {
      try {
        const sentinel = await nav.wakeLock!.request('screen');
        if (cancelled) {
          void sentinel.release();
          return;
        }
        // The OS auto-releases the sentinel when the tab is backgrounded. Listen
        // for that so we null our ref and can re-acquire on the next visible.
        sentinel.addEventListener('release', () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null;
        });
        sentinelRef.current = sentinel;
      } catch {
        // Denied (low battery, permissions, unsupported) — silently no-op.
      }
    };

    const onVisibility = (): void => {
      // Re-acquire whenever we're visible and hold no live sentinel — either the
      // ref is null, or it points at an already-released (stale) sentinel.
      const held = sentinelRef.current;
      if (document.visibilityState === 'visible' && (held === null || held.released)) {
        sentinelRef.current = null;
        void acquire();
      }
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      const s = sentinelRef.current;
      sentinelRef.current = null;
      if (s) void s.release();
    };
  }, [active]);
}
