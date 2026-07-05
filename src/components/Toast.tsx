import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ToastContext, type ToastApi, type ToastKind } from './toastContext.ts';
import './Toast.css';

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

const DISMISS_MS = 3200;

/**
 * Toast host + provider. Wrap the app; consume with `useToast()`. Toasts stack
 * bottom-center above the tab bar and auto-dismiss.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, DISMISS_MS);
  }, []);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-host safe-bottom" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
