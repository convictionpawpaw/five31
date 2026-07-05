import { createContext, useContext } from 'react';

export type ToastKind = 'info' | 'success' | 'danger';

export interface ToastApi {
  /** Show a transient toast. Returns nothing; auto-dismisses. */
  show: (message: string, kind?: ToastKind) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

/** Access the toast API. Must be used under a <ToastProvider>. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx === null) throw new Error('useToast must be used within a <ToastProvider>');
  return ctx;
}
