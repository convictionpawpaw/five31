import { useRef, useState, type ReactNode } from 'react';
import { seedDemoData } from '../../db/devSeed.ts';
import { Button, useToast } from '../../components/index.ts';

/**
 * DEVELOPMENT ONLY. SettingsScreen loads this module through a dynamic import
 * guarded by `import.meta.env.DEV`, so a production build contains neither it
 * nor the seeder. Holding the version line for 0.8s reveals the panel; every
 * seed still asks for confirmation because it wipes all data.
 */
export default function DevSeedPanel({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [showSeed, setShowSeed] = useState(false);
  const [confirmN, setConfirmN] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startHold = () => {
    holdTimer.current = setTimeout(() => setShowSeed(true), 800);
  };
  const cancelHold = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const seed = async (n: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await seedDemoData(n);
      toast.show(`Seeded ${n} cycles`, 'success');
      // Reload so every screen re-reads the fresh DB cleanly. Force the hash to
      // Today first so a reload can never boot into the onboarding wizard.
      if (typeof location !== 'undefined') {
        location.hash = '#/';
        location.reload();
      }
    } catch (err) {
      setBusy(false);
      setConfirmN(null);
      toast.show(err instanceof Error ? err.message : 'Seed failed', 'danger');
    }
  };

  return (
    <>
      <div
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
      >
        {children}
      </div>

      {showSeed && (
        <div className="settings__seed">
          <span className="label text-cyan">DEV: SEED DEMO DATA</span>
          {confirmN === null ? (
            <div className="settings__seed-actions">
              {[1, 3, 12].map((n) => (
                <Button key={n} variant="ghost" onClick={() => setConfirmN(n)} disabled={busy}>
                  {n}
                </Button>
              ))}
            </div>
          ) : (
            <div className="settings__seed-actions">
              <Button variant="ghost" onClick={() => setConfirmN(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void seed(confirmN)} disabled={busy}>
                Wipe + seed {confirmN}
              </Button>
            </div>
          )}
          <p className="label text-low settings__hint">
            {confirmN === null
              ? 'Wipes and regenerates all data.'
              : `Erase ALL data on this device and seed ${confirmN} cycles?`}
          </p>
        </div>
      )}
    </>
  );
}
