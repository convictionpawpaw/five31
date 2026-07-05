import './PrBadge.css';

export interface PrBadgeProps {
  /** Text shown next to the diamond. Defaults to 'PR'. */
  label?: string;
}

/** Amber glowing diamond + label, marking a personal record. */
export function PrBadge({ label = 'PR' }: PrBadgeProps) {
  return (
    <span className="pr-badge">
      <span className="pr-badge__diamond glow-amber" aria-hidden="true" />
      <span className="pr-badge__label label">{label}</span>
    </span>
  );
}
