import { useRef, useState } from 'react';
import './onboarding.css';

/** The controlled-text display for a numeric value (0 shows as empty). */
function textForValue(value: number): string {
  return value === 0 ? '' : String(value);
}

/** Parse a raw field string to a finite number, or 0 for empty/invalid. */
function parseField(raw: string): number {
  if (raw === '' || raw === '.') return 0;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A large decimal-keypad text field with a floating uppercase label.
 *
 * Keeps the RAW typed text in local state so intermediate strings the user must
 * pass through — a trailing '.', or the '82.' between '82' and '82.5' — are not
 * clobbered by a re-render that rounds them away (finding 7). The parsed number
 * is propagated on every valid change; the prop is only allowed to overwrite the
 * text when it represents a genuinely different value (e.g. a reset elsewhere)
 * AND the field is not being actively edited, so the caret/text never jumps
 * mid-typing. On blur the text is normalized to the canonical display.
 */
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
  const [text, setText] = useState<string>(() => textForValue(value));
  const focused = useRef(false);

  // Sync down from the prop only when it disagrees with what the local text
  // parses to, and only while unfocused — so an external change is reflected but
  // ordinary typing (which already round-trips through onChange) is left alone.
  if (!focused.current && parseField(text) !== value) {
    setText(textForValue(value));
  }

  return (
    <label className="field">
      <span className="field__label label">{label}</span>
      <span className="field__box">
        <input
          className="field__input num"
          inputMode="decimal"
          type="text"
          value={text}
          placeholder={placeholder ?? '0'}
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9.]/g, '');
            setText(raw);
            onChange(parseField(raw));
          }}
          onBlur={() => {
            focused.current = false;
            const n = parseField(text);
            onChange(n);
            setText(textForValue(n)); // normalize the display
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
