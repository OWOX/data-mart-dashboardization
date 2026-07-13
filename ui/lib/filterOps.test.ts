import { describe, it, expect } from 'vitest';
import { RELATIVE_PRESETS } from './filterOps';

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
