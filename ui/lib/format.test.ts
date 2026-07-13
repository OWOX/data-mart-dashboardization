import { describe, it, expect } from 'vitest';
import { formatNumber } from './format';

describe('formatNumber', () => {
  it('groups thousands and trims to two decimals', () => {
    expect(formatNumber(1234567.891)).toBe('1,234,567.89');
  });
  it('passes through non-numbers as text', () => {
    expect(formatNumber('abc')).toBe('abc');
    expect(formatNumber(null)).toBe('—');
  });

  // Adversarial / degenerate cases beyond the brief's examples.
  it('renders undefined as the em-dash placeholder', () => {
    expect(formatNumber(undefined)).toBe('—');
  });
  it('renders an empty string as the em-dash placeholder', () => {
    expect(formatNumber('')).toBe('—');
  });
  it('renders NaN as text rather than throwing or printing "NaN" silently swallowed', () => {
    expect(formatNumber(NaN)).toBe('NaN');
  });
  it('renders zero as "0", not the placeholder', () => {
    expect(formatNumber(0)).toBe('0');
  });
  it('renders a negative number with a leading minus and grouping', () => {
    expect(formatNumber(-1234567.891)).toBe('-1,234,567.89');
  });
  it('renders a numeric string the same as the equivalent number', () => {
    expect(formatNumber('1234567.891')).toBe('1,234,567.89');
  });
  it('handles a very large number without throwing', () => {
    expect(() => formatNumber(1e21)).not.toThrow();
    expect(typeof formatNumber(1e21)).toBe('string');
  });
  it('handles Infinity without throwing', () => {
    expect(() => formatNumber(Infinity)).not.toThrow();
  });
  it('does not throw for an object value', () => {
    expect(() => formatNumber({ a: 1 })).not.toThrow();
  });
  it('does not throw for a boolean value', () => {
    expect(() => formatNumber(true)).not.toThrow();
  });
});
