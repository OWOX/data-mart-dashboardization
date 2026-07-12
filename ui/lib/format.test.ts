import { describe, it, expect } from 'vitest';
import { formatNumber, formatDelta } from './format';

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

describe('formatDelta', () => {
  it('computes absolute and percentage change with an up trend', () => {
    expect(formatDelta(150, 100)).toEqual({ abs: 50, pct: 50, trend: 'up' });
  });
  it('reports a down trend', () => {
    expect(formatDelta(50, 100)).toEqual({ abs: -50, pct: -50, trend: 'down' });
  });
  it('treats a zero previous value as flat rather than dividing by zero', () => {
    expect(formatDelta(10, 0)).toEqual({ abs: 10, pct: 0, trend: 'flat' });
  });

  // Adversarial / degenerate cases beyond the brief's examples.
  it('treats equal current and previous as flat with zero delta', () => {
    expect(formatDelta(100, 100)).toEqual({ abs: 0, pct: 0, trend: 'flat' });
  });
  it('treats zero current and zero previous as flat', () => {
    expect(formatDelta(0, 0)).toEqual({ abs: 0, pct: 0, trend: 'flat' });
  });
  it('handles a negative previous value without producing NaN', () => {
    const r = formatDelta(50, -50);
    expect(r.abs).toBe(100);
    expect(Number.isNaN(r.pct)).toBe(false);
  });
  it('never returns Infinity or NaN in pct for any finite inputs', () => {
    for (const [c, p] of [[10, 0], [0, 0], [-5, 0], [1e9, 1], [1, 1e9]]) {
      const r = formatDelta(c, p);
      expect(Number.isFinite(r.pct)).toBe(true);
    }
  });
});
