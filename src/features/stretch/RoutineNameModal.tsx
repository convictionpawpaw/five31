import { useState } from 'react';
import { Button, Modal } from '../../components/index.ts';
import { ROUTINE_NAME_MAX } from '../../db/repo/index.ts';
import './stretch.css';

/**
 * Small modal asking for a saved routine's name (Save and Rename). `onSubmit`
 * receives the raw text; the repo trims and validates it, and a thrown error's
 * message is shown inline so the user can fix the name.
 */
export function RoutineNameModal({
  title,
  initialName,
  confirmLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  initialName: string;
  confirmLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= ROUTINE_NAME_MAX;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the name.');
      setBusy(false);
    }
  };

  return (
    <Modal open title={title} onClose={() => !busy && onClose()}>
      <form className="sroutine__form" onSubmit={(e) => void submit(e)}>
        <label className="label" htmlFor="sroutine-name">
          Name
        </label>
        <input
          id="sroutine-name"
          className="stretch__input"
          type="text"
          autoComplete="off"
          value={name}
          maxLength={ROUTINE_NAME_MAX + 10}
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
        <p className={`sroutine__hint${trimmed.length > ROUTINE_NAME_MAX ? ' text-amber' : ''}`}>
          {trimmed.length}/{ROUTINE_NAME_MAX}
        </p>
        {error && (
          <p className="sroutine__hint text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="splayer__modal-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" block disabled={!valid || busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
