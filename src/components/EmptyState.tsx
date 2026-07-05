import type { ReactNode } from 'react';
import './EmptyState.css';

export interface EmptyStateProps {
  /** Big uppercase title, e.g. the screen name. */
  title: string;
  /** Secondary line, e.g. 'SYSTEM PENDING'. */
  message?: string;
  /** Optional action(s) rendered below the message. */
  children?: ReactNode;
}

/** Centered placeholder for empty screens and not-yet-built features. */
export function EmptyState({ title, message, children }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state__mark" aria-hidden="true">
        //
      </div>
      <h2 className="empty-state__title label label-hi">{title}</h2>
      {message !== undefined && <p className="empty-state__msg label">{message}</p>}
      {children !== undefined && <div className="empty-state__actions">{children}</div>}
    </div>
  );
}
