import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './Button.css';

export type ButtonVariant = 'primary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Stretch to fill the container width. */
  block?: boolean;
  children: ReactNode;
}

/**
 * The one button. Amber primary (glowing), hairline ghost, red danger. Always
 * at least --tap (48px) tall for finger targets.
 */
export function Button({
  variant = 'ghost',
  block = false,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn--${variant}`, block ? 'btn--block' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
