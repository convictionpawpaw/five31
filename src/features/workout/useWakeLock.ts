import { useEffect, useRef } from 'react';

/**
 * Hold a `navigator.wakeLock('screen')` sentinel while `active` is true so the
 * phone screen doesn't sleep mid-workout. Re-acquires when the tab returns to
 * the foreground (the OS drops the lock on visibility change), and releases on
 * unmount / when `active` goes false. Silently no-ops where the API is missing.
 *
 * At most one sentinel is ever held: a request already in flight is never
 * duplicated (a visibilitychange during it is re-checked once it settles), and
 * a sentinel that resolves after the effect was torn down is released at once.
 */
export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & { wakeLock?: WakeLock };
    if (!nav.wakeLock) return;

    let cancelled = false;
    let pending = false;
    let recheck = false;

    const holding = (): boolean => {
      const held = sentinelRef.current;
      return held !== null && !held.released;
    };

    const acquire = async (): Promise<void> => {
      if (cancelled) return;
      if (pending) {
        // A request is in flight; look again once it settles.
        recheck = true;
        return;
      }
      if (holding()) return;
      sentinelRef.current = null;
      pending = true;
      try {
        const sentinel = await nav.wakeLock!.request('screen');
        if (cancelled || holding()) {
          void sentinel.release();
        } else {
          // The OS auto-releases the sentinel when the tab is backgrounded.
          // Listen for that so we null our ref and can re-acquire on visible.
          sentinel.addEventListener('release', () => {
            if (sentinelRef.current === sentinel) sentinelRef.current = null;
          });
          sentinelRef.current = sentinel;
        }
      } catch {
        // Denied (low battery, permissions, unsupported) — silently no-op.
      } finally {
        pending = false;
      }
      if (recheck && !cancelled) {
        recheck = false;
        onVisibility();
      }
    };

    const onVisibility = (): void => {
      // Re-acquire whenever we're visible and hold no live sentinel — either the
      // ref is null, or it points at an already-released (stale) sentinel.
      if (document.visibilityState === 'visible' && !holding()) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      const s = sentinelRef.current;
      sentinelRef.current = null;
      if (s && !s.released) void s.release();
    };
  }, [active]);
}
