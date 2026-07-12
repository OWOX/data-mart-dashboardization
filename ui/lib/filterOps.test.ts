import { describe, it, expect } from 'vitest';
import { operatorsFor, valueKind, RELATIVE_PRESETS } from './filterOps';

describe('operatorsFor', () => {
  it('never offers `in`/`not_in` — the query service rejects them', () => {
    for (const t of ['STRING', 'INTEGER', 'DATE', 'BOOLEAN']) {
      expect(operatorsFor(t)).not.toContain('in');
      expect(operatorsFor(t)).not.toContain('not_in');
    }
  });
  it('offers relative_date only for temporal types', () => {
    expect(operatorsFor('DATE')).toContain('relative_date');
    expect(operatorsFor('STRING')).not.toContain('relative_date');
  });
  it('offers substring operators only for strings', () => {
    expect(operatorsFor('STRING')).toContain('contains');
    expect(operatorsFor('INTEGER')).not.toContain('contains');
  });

  // Adversarial / guard-rail cases beyond the brief's examples.
  it('never offers in_next_n_days for any type — the query service rejects it', () => {
    for (const t of ['STRING', 'INTEGER', 'DATE', 'BOOLEAN', 'DATETIME', 'TIMESTAMP']) {
      expect(operatorsFor(t)).not.toContain('in_next_n_days');
    }
  });
  it('recognizes common numeric type spellings (INTEGER, FLOAT, NUMERIC, BIGNUMERIC)', () => {
    for (const t of ['INTEGER', 'INT64', 'FLOAT', 'FLOAT64', 'NUMERIC', 'BIGNUMERIC']) {
      expect(operatorsFor(t)).toContain('between');
    }
  });
  it('recognizes common temporal type spellings (DATE, DATETIME, TIMESTAMP)', () => {
    for (const t of ['DATE', 'DATETIME', 'TIMESTAMP']) {
      expect(operatorsFor(t)).toContain('relative_date');
    }
  });
  it('recognizes boolean type and offers only boolean-shaped operators', () => {
    const ops = operatorsFor('BOOLEAN');
    expect(ops).toContain('is_true');
    expect(ops).toContain('is_false');
    expect(ops).not.toContain('contains');
    expect(ops).not.toContain('between');
  });
  it('falls back to string operators for an unrecognized type rather than throwing', () => {
    expect(() => operatorsFor('SOME_UNKNOWN_TYPE')).not.toThrow();
    expect(operatorsFor('SOME_UNKNOWN_TYPE')).toEqual(operatorsFor('STRING'));
  });
  it('is case-insensitive on type names', () => {
    expect(operatorsFor('integer')).toEqual(operatorsFor('INTEGER'));
    expect(operatorsFor('date')).toEqual(operatorsFor('DATE'));
  });
  it('every returned operator list includes null checks', () => {
    for (const t of ['STRING', 'INTEGER', 'DATE', 'BOOLEAN']) {
      const ops = operatorsFor(t);
      expect(ops).toContain('is_null');
      expect(ops).toContain('is_not_null');
    }
  });
});

describe('valueKind', () => {
  it('classifies operator value shapes', () => {
    expect(valueKind('between')).toBe('between');
    expect(valueKind('relative_date')).toBe('relative');
    expect(valueKind('is_null')).toBe('none');
    expect(valueKind('eq')).toBe('scalar');
  });

  // Adversarial cases.
  it('classifies every unary operator as none', () => {
    for (const op of ['is_empty', 'is_not_empty', 'is_null', 'is_not_null', 'is_true', 'is_false']) {
      expect(valueKind(op)).toBe('none');
    }
  });
  it('defaults an unrecognized operator to scalar rather than throwing', () => {
    expect(() => valueKind('some_unknown_operator')).not.toThrow();
    expect(valueKind('some_unknown_operator')).toBe('scalar');
  });
});

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
