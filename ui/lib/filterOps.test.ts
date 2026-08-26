import { describe, it, expect } from 'vitest';
import { RELATIVE_PRESETS, describeFilter, isSelected, selectedValues, toggleValue } from './filterOps';
import type { FilterRule } from './types';

describe('RELATIVE_PRESETS', () => {
  it('excludes this_week, which the service rejects', () => {
    expect(RELATIVE_PRESETS.map(p => p.kind)).not.toContain('this_week');
  });
  it('includes the supported presets', () => {
    expect(RELATIVE_PRESETS.map(p => p.kind)).toEqual(
      expect.arrayContaining(['today', 'yesterday', 'this_month', 'last_month', 'this_year', 'last_n_days', 'last_n_months'])
    );
  });

  // Guard rail against reintroducing any rejected operator/preset.
  it('excludes in_next_n_days, which the service rejects', () => {
    expect(RELATIVE_PRESETS.map(p => p.kind)).not.toContain('in_next_n_days');
  });
  it('flags needsN correctly for the N-parameterized presets', () => {
    const byKind = Object.fromEntries(RELATIVE_PRESETS.map(p => [p.kind, p]));
    expect(byKind['last_n_days'].needsN).toBe(true);
    expect(byKind['last_n_months'].needsN).toBe(true);
    expect(byKind['today'].needsN).toBe(false);
    expect(byKind['this_year'].needsN).toBe(false);
  });
});


describe('multi-select cross-filtering', () => {
  const eq = (column: string, value: unknown): FilterRule => ({ column, operator: 'eq', value });

  it('first click selects one value as `eq`', () => {
    expect(toggleValue([], 'status', 'active')).toEqual([eq('status', 'active')]);
  });

  it('a second value on the same column WIDENS to `in`, it does not replace', () => {
    const one = toggleValue([], 'status', 'active');
    expect(toggleValue(one, 'status', 'invited')).toEqual([
      { column: 'status', operator: 'in', value: ['active', 'invited'] },
    ]);
  });

  it('deselecting narrows `in` back to `eq`, then removes the rule entirely', () => {
    let filters = toggleValue(toggleValue([], 'status', 'active'), 'status', 'invited');
    filters = toggleValue(filters, 'status', 'active');
    expect(filters).toEqual([eq('status', 'invited')]);
    expect(toggleValue(filters, 'status', 'invited')).toEqual([]);
  });

  it('never emits `in` with an empty list — the endpoint answers 400 to that', () => {
    const emptied = toggleValue(toggleValue([], 'status', 'active'), 'status', 'active');
    expect(emptied).toEqual([]);
    expect(emptied.some(f => f.operator === 'in')).toBe(false);
  });

  it('other columns are untouched — selections on different dimensions AND together', () => {
    const filters = toggleValue(toggleValue([], 'country', 'US'), 'status', 'active');
    expect(toggleValue(filters, 'status', 'invited')).toEqual([
      eq('country', 'US'),
      { column: 'status', operator: 'in', value: ['active', 'invited'] },
    ]);
  });

  it('keeps non-string dimension values uncoerced', () => {
    const filters = toggleValue(toggleValue([], 'rating', 4), 'rating', 5);
    expect(filters).toEqual([{ column: 'rating', operator: 'in', value: [4, 5] }]);
    expect(isSelected(filters, 'rating', 4)).toBe(true);
    expect(isSelected(filters, 'rating', '4')).toBe(false);
  });

  it('reads the selection back for chart highlighting, from either operator', () => {
    expect(selectedValues([eq('status', 'active')], 'status')).toEqual(['active']);
    expect(selectedValues([{ column: 'status', operator: 'in', value: ['a', 'b'] }], 'status')).toEqual(['a', 'b']);
    expect(selectedValues([], 'status')).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const filters: FilterRule[] = [eq('status', 'active')];
    toggleValue(filters, 'status', 'invited');
    expect(filters).toEqual([eq('status', 'active')]);
  });

  it('describes both shapes for the filter bar', () => {
    expect(describeFilter(eq('country', 'US'))).toBe('country = US');
    expect(describeFilter({ column: 'status', operator: 'in', value: ['a', 'b'] })).toBe('status in (a, b)');
    expect(describeFilter({ column: 'status', operator: 'not_in', value: ['a'] })).toBe('status not in (a)');
  });
});
