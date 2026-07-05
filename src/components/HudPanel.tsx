import type { HTMLAttributes, ReactNode } from 'react';

export interface HudPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Optional uppercase title strip rendered at the top of the panel. */
  title?: string;
  /** Brighten the corner brackets to full cyan (active state). */
  active?: boolean;
  children: ReactNode;
}

/**
 * The primary surface: a flat panel with hairline border and cyan corner
 * brackets (styling lives in effects.css `.hud-panel`).
 */
export function HudPanel({ title, active = false, className, children, ...rest }: HudPanelProps) {
  const classes = ['hud-panel', active ? 'is-active' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} {...rest}>
      {title !== undefined && <div className="hud-panel__title">{title}</div>}
      {children}
    </div>
  );
}
