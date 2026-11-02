import { compact, formatDelta, formatPct, formatWindow } from './format';

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
