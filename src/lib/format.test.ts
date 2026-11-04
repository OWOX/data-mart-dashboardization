import { compact, formatDelta, formatDeltaFor, formatValue, formatPct, formatPeriod, formatWindow } from './format';

test.each([[964, '964'], [7148, '7.15K'], [1_240_000, '1.24M'], [12.345, '12.3'], [0, '0'], [null, '—']] as const)(
  'compact %s', (n, s) => expect(compact(n)).toBe(s),
);

test('formatPct', () => {
  expect(formatPct(8.333)).toBe('+8.3%');
  expect(formatPct(-4)).toBe('−4.0%');
  expect(formatPct(0)).toBe('0.0%');
  expect(formatPct(null)).toBe('');
});


test('formatDelta signs a compact difference', () => {
  expect(formatDelta(12_400)).toBe('+12.4K');
  expect(formatDelta(-3)).toBe('−3');
  expect(formatDelta(0)).toBe('0');
  expect(formatDelta(null)).toBe('');
});

test('formatWindow keeps a range short', () => {
  expect(formatWindow({ from: '2026-10-01', to: '2026-10-07' })).toBe('Oct 1–7, 2026');
  expect(formatWindow({ from: '2026-10-01', to: '2026-11-01' })).toBe('Oct 1 – Nov 1, 2026');
  expect(formatWindow({ from: '2025-12-30', to: '2026-01-05' })).toBe('Dec 30, 2025 – Jan 5, 2026');
  expect(formatWindow({ from: '2026-11-01', to: '2026-11-01' })).toBe('Nov 1, 2026');
});

test('a period writes the year once when every day falls in one year', () => {
  expect(formatPeriod({ from: '2026-10-01', to: '2026-11-01' }, { from: '2026-07-01', to: '2026-08-01' })).toBe('Oct 1 – Nov 1 vs Jul 1 – Aug 1, 2026');
  expect(formatPeriod({ from: '2026-01-01', to: '2026-01-31' }, { from: '2025-12-01', to: '2025-12-31' })).toBe('Jan 1–31, 2026 vs Dec 1–31, 2025');
  expect(formatPeriod({ from: '2026-10-01', to: '2026-12-31' }, null)).toBe('Oct 1 – Dec 31, 2026');
  expect(formatPeriod({ from: '2026-10-05', to: '2026-10-05' }, { from: '2026-10-04', to: '2026-10-04' })).toBe('Oct 5 vs Oct 4, 2026');
});

test('formatValue renders a percent, a currency and a number', () => {
  expect(formatValue(0.0402, { format: 'percent', currency: null })).toBe('4.0%');
  expect(formatValue(7148, { format: 'currency', currency: 'USD' })).toBe('$7.15K');
  expect(formatValue(7148, { format: 'currency', currency: null })).toBe('7.15K');
  expect(formatValue(7148, { format: 'currency', currency: 'nope' })).toBe('7.15K');
  expect(formatValue(7148, { format: 'number', currency: null })).toBe('7.15K');
  expect(formatValue(null, { format: 'percent', currency: null })).toBe('—');
});

test('formatDeltaFor shows percentage points for a percent', () => {
  const pct = { format: 'percent', currency: null } as const;
  expect(formatDeltaFor(0.012, pct)).toBe('+1.2 pp');
  expect(formatDeltaFor(-0.03, pct)).toBe('−3.0 pp');
  expect(formatDeltaFor(0, pct)).toBe('0.0 pp');
  expect(formatDeltaFor(12_400, { format: 'currency', currency: 'USD' })).toBe('+$12.4K');
  expect(formatDeltaFor(-3, { format: 'number', currency: null })).toBe('−3');
});
