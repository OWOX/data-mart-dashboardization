import { describe, it, expect } from 'vitest';
import { applySelection, groupBySource, groupFields, toggleField, usedFields } from './fields';
import { emptyDashboard } from './types';
import type { BarConfig, Dashboard, MartField, PieConfig, ScorecardConfig } from './types';

const fields: MartField[] = [
  { name: 'id', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT', 'COUNT_DISTINCT'], isPrimaryKey: true },
  { name: 'created', type: 'TIMESTAMP', role: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
  { name: 'modified', type: 'TIMESTAMP', role: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
  { name: 'status', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT', 'COUNT_DISTINCT'] },
  { name: 'email', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT', 'COUNT_DISTINCT'] },
  { name: 'revenue', type: 'FLOAT', role: 'metric', allowedAggregations: ['SUM', 'AVG'] },
];

function dash(): Dashboard {
  return {
    ...emptyDashboard('d1', 'm1', 'Users'),
    slices: [{ column: 'created', operator: 'relative_date', value: { kind: 'last_n_days', n: 30 } }],
    components: [
      { id: 'sc', type: 'scorecard', title: 'Unique Count', width: 1, height: 1, config: { metric: 'id', aggregation: 'COUNT_DISTINCT' } },
      { id: 'pie', type: 'pie', title: 'Unique Count by status', width: 2, height: 2, config: { dimension: 'status', metric: 'id', aggregation: 'COUNT_DISTINCT', maxCategories: 8 } },
    ],
  };
}

describe('groupFields', () => {
  it('splits into the three menu sections, with Unique Count leading the metrics', () => {
    const g = groupFields(fields);
    expect(g.dates.map(f => f.name)).toEqual(['created', 'modified']);
    expect(g.metrics.map(f => f.name)).toEqual(['id', 'revenue']);
    expect(g.metrics[0].allowedAggregations).toEqual(['COUNT_DISTINCT']);
    // The primary key is a metric here, never a grouping dimension.
    expect(g.dimensions.map(f => f.name)).toEqual(['status', 'email']);
  });
});

describe('usedFields', () => {
  it('reports every column the dashboard references, across slices and configs', () => {
    expect(usedFields(dash())).toEqual(new Set(['created', 'id', 'status']));
  });
});

describe('toggleField', () => {
  const byName = (n: string) => fields.find(f => f.name === n)!;

  it('checking a date field adds its global range', () => {
    const d = toggleField(dash(), byName('modified'), true, fields);
    expect(d.slices.map(s => s.column)).toEqual(['created', 'modified']);
  });

  it('checking a metric adds a scorecard within the field\'s governance', () => {
    const d = toggleField(dash(), byName('revenue'), true, fields);
    const card = d.components.at(-1)!;
    expect(card.type).toBe('scorecard');
    expect(card.config as ScorecardConfig).toEqual({ metric: 'revenue', aggregation: 'SUM' });
  });

  it('checking a low-cardinality dimension adds a pie, a wide one a bar', () => {
    const pie = toggleField(dash(), byName('email'), true, fields, { email: 4 }).components.at(-1)!;
    expect(pie.type).toBe('pie');
    expect((pie.config as PieConfig).dimension).toBe('email');

    const bar = toggleField(dash(), byName('email'), true, fields, { email: 900 }).components.at(-1)!;
    expect(bar.type).toBe('bar');
    expect((bar.config as BarConfig).limit).toBe(10);
  });

  it('an unprobed dimension is assumed wide — a bar degrades where a pie would not', () => {
    const c = toggleField(dash(), byName('email'), true, fields).components.at(-1)!;
    expect(c.type).toBe('bar');
  });

  it('a new dimension chart measures the dashboard\'s existing metric', () => {
    const c = toggleField(dash(), byName('email'), true, fields, { email: 3 }).components.at(-1)!;
    expect((c.config as PieConfig).metric).toBe('id');
  });

  it('unchecking removes only what that field owns', () => {
    const d = toggleField(dash(), byName('status'), false, fields);
    expect(d.components.map(c => c.id)).toEqual(['sc']);        // the pie went, the scorecard stayed
    expect(d.slices).toHaveLength(1);
  });

  it('unchecking a date field drops its range and any component charting it', () => {
    const withSeries: Dashboard = {
      ...dash(),
      components: [
        ...dash().components,
        { id: 'ts', type: 'timeseries', title: 'over time', width: 5, height: 2, config: { dateField: 'created', metric: 'id', aggregation: 'COUNT_DISTINCT', unit: 'DAY' } },
      ],
    };
    const d = toggleField(withSeries, byName('created'), false, fields);
    expect(d.slices).toEqual([]);
    expect(d.components.map(c => c.id)).toEqual(['sc', 'pie']);
  });

  it('bumps configVersion so every component refetches', () => {
    expect(toggleField(dash(), byName('revenue'), true, fields).configVersion).toBe(1);
  });

  it('is a no-op when the field is already in the wanted state', () => {
    const d = dash();
    expect(toggleField(d, byName('created'), true, fields)).toBe(d);
  });
});

describe('applySelection', () => {
  it('applies a whole selection as ONE version bump, not one per field', () => {
    const before = dash();
    const after = applySelection(before, new Set(['created', 'id', 'status', 'revenue', 'modified']), fields);

    expect(after.configVersion).toBe(before.configVersion + 1);
    expect(after.slices.map(s => s.column)).toEqual(['created', 'modified']);
    expect(after.components.some(c => (c.config as ScorecardConfig).metric === 'revenue')).toBe(true);
  });

  it('adds and removes in the same pass', () => {
    const after = applySelection(dash(), new Set(['id', 'revenue']), fields);
    expect(after.slices).toEqual([]);                                    // created unticked
    expect(after.components.map(c => c.type)).toEqual(['scorecard', 'scorecard']); // pie gone, revenue added
  });

  it('returns the same object when nothing changed, so no refetch is triggered', () => {
    const d = dash();
    expect(applySelection(d, usedFields(d), fields)).toBe(d);
  });
});


describe('groupBySource', () => {
  const joined: MartField[] = [
    ...fields,
    { name: 'contact_entity__id', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT_DISTINCT'], alias: 'Email', source: { aliasPath: 'contact_entity', title: 'Contact | Entity' } },
    { name: 'contact_entity__revenue', type: 'FLOAT', role: 'metric', allowedAggregations: ['SUM'], alias: 'Revenue', source: { aliasPath: 'contact_entity', title: 'Contact | Entity' } },
    { name: 'org__created', type: 'TIMESTAMP', role: 'dimension', allowedAggregations: ['MIN'], alias: 'Created', source: { aliasPath: 'org', title: 'Organization | Entity' } },
  ];

  it('puts the dashboard\'s own Data Mart first, then joined sources alphabetically', () => {
    const groups = groupBySource(joined, new Set());
    expect(groups.map(g => g.aliasPath)).toEqual(['', 'contact_entity', 'org']);
  });

  it('splits each source into its own three columns', () => {
    const [own, contact, org] = groupBySource(joined, new Set());
    expect(own.groups.metrics.map(f => f.name)).toEqual(['id', 'revenue']);   // Unique Count leads
    expect(contact.groups.metrics.map(f => f.name)).toEqual(['contact_entity__revenue']);
    expect(contact.groups.dimensions.map(f => f.name)).toEqual(['contact_entity__id']);
    expect(org.groups.dates.map(f => f.name)).toEqual(['org__created']);
  });

  it('offers Unique Count for the mart itself only — a joined source has no such column', () => {
    const groups = groupBySource(joined, new Set());
    const joinedMetrics = groups.slice(1).flatMap(g => g.groups.metrics);
    expect(joinedMetrics.every(f => !f.isPrimaryKey)).toBe(true);
  });

  it('counts how many of each source\'s fields are in use', () => {
    const groups = groupBySource(joined, new Set(['created', 'contact_entity__revenue']));
    expect(groups[0].selectedCount).toBe(1);
    expect(groups[1].selectedCount).toBe(1);
    expect(groups[2].selectedCount).toBe(0);
  });
});

describe('hidden components', () => {
  const dashboard = (): Dashboard => ({
    ...emptyDashboard('d1', 'm1', 'Users'),
    components: [
      { id: 'sc', type: 'scorecard', title: 'Revenue', width: 1, height: 1, hidden: true, config: { metric: 'revenue', aggregation: 'SUM' } },
    ],
  });

  it('a hidden component\'s field reads as not in use', () => {
    expect(usedFields(dashboard()).has('revenue')).toBe(false);
  });

  it('re-ticking the field un-hides the original component rather than adding a second', () => {
    const d = dashboard();
    const next = toggleField(d, fields.find(f => f.name === 'revenue')!, true, fields);
    expect(next.components).toHaveLength(1);
    expect(next.components[0].id).toBe('sc');
    expect(next.components[0].hidden).toBeUndefined();
  });
});
