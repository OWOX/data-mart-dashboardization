import type { FilterRule } from './types';

/**
 * The operator catalogue the UI may offer, and the multi-select model built on it.
 *
 * It is still NARROWER than the backend's schema — `in_next_n_days` and `this_week` are rejected by
 * the query service and are never offered. `in`/`not_in` USED to be in that list; they are now
 * supported, verified against the live endpoint:
 *
 *     filter [{column:'status', operator:'in',     value:['active','invited']}]  → 200, 2 groups
 *     filter [{column:'status', operator:'not_in', value:['active']}]            → 200, excludes it
 *     filter [{column:'status', operator:'in',     value:[]}]                    → 400
 *
 * That last line is the constraint the helpers below exist to honour: an `in` with no values is a
 * rejected request, not an empty selection, so a selection that empties out drops the rule entirely
 * and a selection of one stays `eq`.
 */

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


/** Values currently selected on a column: `eq` contributes one, `in` contributes its list. */
export function selectedValues(filters: FilterRule[], column: string): unknown[] {
  const rule = filters.find(f => f.column === column);
  if (!rule) return [];
  if (rule.operator === 'in') return Array.isArray(rule.value) ? [...rule.value] : [];
  if (rule.operator === 'eq') return [rule.value];
  return [];
}

/** Whether a value is part of the current selection — what a chart marks as active. */
export function isSelected(filters: FilterRule[], column: string, value: unknown): boolean {
  return selectedValues(filters, column).some(v => sameValue(v, value));
}

/**
 * Multi-select toggle for one value of one column, the whole cross-filter interaction in one place.
 *
 * Adding to a selection widens it (`eq` → `in`), removing narrows it back (`in` → `eq` → no rule at
 * all). The narrowing matters as much as the widening: an `in` carrying a single value is
 * needlessly obscure, and an `in` carrying none is a 400.
 */
export function toggleValue(filters: FilterRule[], column: string, value: unknown): FilterRule[] {
  const current = selectedValues(filters, column);
  const next = current.some(v => sameValue(v, value))
    ? current.filter(v => !sameValue(v, value))
    : [...current, value];
  const others = filters.filter(f => f.column !== column);

  if (next.length === 0) return others;
  if (next.length === 1) return [...others, { column, operator: 'eq', value: next[0] }];
  return [...others, { column, operator: 'in', value: next }];
}

/** How a rule reads in the filter bar: `country = US`, or `status in (active, invited)`. */
export function describeFilter(f: FilterRule): string {
  if (f.operator === 'in' || f.operator === 'not_in') {
    const values = Array.isArray(f.value) ? f.value : [];
    const verb = f.operator === 'in' ? 'in' : 'not in';
    return `${f.column} ${verb} (${values.map(String).join(', ')})`;
  }
  return `${f.column} = ${String(f.value)}`;
}

/**
 * Dimension cells are scalars (a dimension may legitimately be numeric — see `toPoints`' `raw`),
 * so identity is the right comparison; `Object.is` only differs from `===` on NaN and ±0, neither
 * of which is a meaningful dimension value.
 */
const sameValue = (a: unknown, b: unknown) => Object.is(a, b);
