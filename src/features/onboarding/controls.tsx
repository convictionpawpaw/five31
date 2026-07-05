import './onboarding.css';

/** A large decimal-keypad text field with a floating uppercase label. */
export function DecimalField({
  label,
  value,
  onChange,
  suffix,
  placeholder,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span className="field__label label">{label}</span>
      <span className="field__box">
        <input
          className="field__input num"
          inputMode="decimal"
          type="text"
          value={value === 0 ? '' : String(value)}
          placeholder={placeholder ?? '0'}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9.]/g, '');
            const n = raw === '' ? 0 : Number.parseFloat(raw);
            onChange(Number.isFinite(n) ? n : 0);
          }}
        />
        {suffix !== undefined && <span className="field__suffix label">{suffix}</span>}
      </span>
    </label>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/** Two-or-more-way segmented toggle. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`segmented__opt${opt.value === value ? ' is-active' : ''}`}
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
