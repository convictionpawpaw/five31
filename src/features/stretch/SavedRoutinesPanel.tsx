import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { SavedRoutine } from '../../core/stretch/types.ts';
import { getStretch } from '../../core/stretch/library.ts';
import { deleteSavedRoutine, listSavedRoutines, renameSavedRoutine } from '../../db/repo/index.ts';
import { Button, HudPanel, Modal, useToast } from '../../components/index.ts';
import { RoutineNameModal } from './RoutineNameModal.tsx';
import { distinctStretchCount, routineReps, stepRuns } from './routineFormat.ts';
import './stretch.css';

/**
 * Saved routines on the Stretch screen: each with Start, Rename and Delete
 * (Delete confirms). Tapping a name expands its read-only stretch list.
 * Hidden while there are none. `onStart` is called straight from the tap so
 * the player's audio unlock and auto-start token stay inside the gesture.
 */
export function SavedRoutinesPanel({ onStart }: { onStart: (saved: SavedRoutine) => void }) {
  const toast = useToast();
  const saved = useLiveQuery(listSavedRoutines, []);
  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<SavedRoutine | null>(null);
  const [deleting, setDeleting] = useState<SavedRoutine | null>(null);
  const [busy, setBusy] = useState(false);

  if (!saved || saved.length === 0) return null;

  const confirmDelete = async () => {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await deleteSavedRoutine(deleting.id);
      toast.show('Routine deleted', 'info');
    } catch {
      toast.show('Could not delete the routine', 'danger');
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };

  return (
    <HudPanel title="Saved routines" className="sroutine">
      <ul className="sroutine__list">
        {saved.map((s) => {
          const r = s.routine;
          const reps = routineReps(r);
          const expanded = open === s.id;
          return (
            <li key={s.id} className="sroutine__item">
              <button
                type="button"
                className="sroutine__name"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : s.id)}
              >
                {s.name}
              </button>
              <p className="label text-low sroutine__meta">
                {r.minutes} min · {distinctStretchCount(r)} stretches
                {reps > 1 ? ` · ${reps}x` : ''}
              </p>
              {expanded && (
                <ol className="sroutine__steps">
                  {stepRuns(r.steps).map((run) => (
                    <li key={run.firstStep}>
                      {getStretch(run.stretchId)?.name ?? 'Unknown stretch'}
                      <span className="text-low">
                        {run.bilateral ? ' · each side' : ''}
                        {run.repOf > 1 ? ` · ×${run.repOf}` : ''} · {run.holdSec}s
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <div className="sroutine__actions">
                <Button variant="primary" onClick={() => onStart(s)}>
                  Start
                </Button>
                <Button variant="ghost" onClick={() => setRenaming(s)}>
                  Rename
                </Button>
                <Button variant="ghost" onClick={() => setDeleting(s)}>
                  Delete
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {renaming && (
        <RoutineNameModal
          title="Rename routine"
          initialName={renaming.name}
          confirmLabel="Rename"
          onClose={() => setRenaming(null)}
          onSubmit={async (name) => {
            await renameSavedRoutine(renaming.id, name);
            setRenaming(null);
            toast.show('Routine renamed', 'info');
          }}
        />
      )}

      {deleting && (
        <Modal open title="Delete routine?" onClose={() => !busy && setDeleting(null)}>
          <p className="splayer__modal-copy">
            Delete “{deleting.name}”? This removes the saved routine only; your stretch history and
            streak are not affected.
          </p>
          <div className="splayer__modal-actions">
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" block onClick={() => void confirmDelete()} disabled={busy}>
              Delete
            </Button>
          </div>
        </Modal>
      )}
    </HudPanel>
  );
}
