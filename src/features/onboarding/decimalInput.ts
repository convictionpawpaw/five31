/**
 * Clean a raw decimal-field string down to digits and at most the separators
 * the user meant. A SINGLE comma with no dot is a decimal separator (an iPhone
 * on a comma-decimal locale types '82,5'): it becomes '82.5', never 825. Any
 * other comma (several of them, or alongside a dot) is a grouping mark and is
 * dropped, as before.
 */
export function sanitizeDecimalInput(raw: string): string {
  let s = raw;
  if (!s.includes('.')) {
    const first = s.indexOf(',');
    if (first !== -1 && s.indexOf(',', first + 1) === -1) {
      s = `${s.slice(0, first)}.${s.slice(first + 1)}`;
    }
  }
  return s.replace(/[^0-9.]/g, '');
}
