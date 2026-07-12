/**
 * The operator catalogue the UI may offer. It is deliberately NARROWER than the backend's schema:
 * `in`, `not_in`, `in_next_n_days` and `this_week` are rejected by the query service, so they are
 * never offered. That is why there are no multi-select dimension filters in v1.
 *
 * `compile.ts` passes filter rules through verbatim and cannot itself prevent a bad operator —
 * THIS file is the enforcement point, because it is where the filter UI gets its operator list.
 */
const NUMBER = /^(INT|FLOAT|NUMERIC|BIGNUMERIC|DECIMAL|DOUBLE|LONG)/i;
const TEMPORAL = /^(DATE|DATETIME|TIMESTAMP|TIME)$/i;
const BOOLEAN = /^BOOL/i;

const OPERATORS = {
  string: ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty', 'is_null', 'is_not_null'],
  number: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'between', 'is_null', 'is_not_null'],
  datetime: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'between', 'relative_date', 'is_null', 'is_not_null'],
  boolean: ['is_true', 'is_false', 'is_null', 'is_not_null'],
} as const;

export function operatorsFor(type: string): string[] {
  if (NUMBER.test(type)) return [...OPERATORS.number];
  if (TEMPORAL.test(type)) return [...OPERATORS.datetime];
  if (BOOLEAN.test(type)) return [...OPERATORS.boolean];
  return [...OPERATORS.string];
}

const UNARY = new Set(['is_empty', 'is_not_empty', 'is_null', 'is_not_null', 'is_true', 'is_false']);

export function valueKind(operator: string): 'scalar' | 'between' | 'relative' | 'none' {
  if (operator === 'between') return 'between';
  if (operator === 'relative_date') return 'relative';
  if (UNARY.has(operator)) return 'none';
  return 'scalar';
}

/** `this_week` and `in_next_n_days` are intentionally absent — the query service rejects both. */
export const RELATIVE_PRESETS: { kind: string; label: string; needsN: boolean }[] = [
  { kind: 'today', label: 'Today', needsN: false },
  { kind: 'yesterday', label: 'Yesterday', needsN: false },
  { kind: 'last_n_days', label: 'Last N days', needsN: true },
  { kind: 'this_month', label: 'This month', needsN: false },
  { kind: 'last_month', label: 'Last month', needsN: false },
  { kind: 'last_n_months', label: 'Last N months', needsN: true },
  { kind: 'this_year', label: 'This year', needsN: false },
];
