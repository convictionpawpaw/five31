import { describe, it, expect } from 'vitest';
import { sanitizeDecimalInput } from '../decimalInput.ts';

describe('sanitizeDecimalInput', () => {
  it('treats a single comma as the decimal separator when there is no dot', () => {
    expect(sanitizeDecimalInput('82,5')).toBe('82.5');
    expect(sanitizeDecimalInput('82,')).toBe('82.');
    expect(sanitizeDecimalInput(',5')).toBe('.5');
  });

  it('drops commas used as grouping marks', () => {
    expect(sanitizeDecimalInput('1,234.5')).toBe('1234.5');
    expect(sanitizeDecimalInput('1,234,567')).toBe('1234567');
  });

  it('keeps plain digits and dots, and strips everything else', () => {
    expect(sanitizeDecimalInput('82.5')).toBe('82.5');
    expect(sanitizeDecimalInput('225 lb')).toBe('225');
    expect(sanitizeDecimalInput('')).toBe('');
  });
});
