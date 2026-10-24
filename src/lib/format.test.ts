import { compact, formatPct, metricLabel } from './format';

test.each([[964, '964'], [7148, '7.15K'], [1_240_000, '1.24M'], [12.345, '12.3'], [0, '0'], [null, '—']] as const)(
  'compact %s', (n, s) => expect(compact(n)).toBe(s),
);

test('formatPct', () => {
  expect(formatPct(8.333)).toBe('+8.3%');
  expect(formatPct(-4)).toBe('−4.0%');
  expect(formatPct(0)).toBe('0.0%');
  expect(formatPct(null)).toBe('');
});

test('labels never say Unique Count', () => {
  expect(metricLabel('ARR', 'Customers', false)).toBe('ARR from Customers');
  expect(metricLabel('Customers', 'Customers', true)).toBe('Customers');
});
