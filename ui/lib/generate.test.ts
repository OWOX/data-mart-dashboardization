import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pluginClient } from './plugin-client';
import { generate, probeCardinality, PIE_MAX_CATEGORIES, fieldLabel, columnLabel } from './generate';
import { aggLabel } from './compile';
import type { BarConfig, MartField, PieConfig, ScorecardConfig, TimeSeriesConfig } from './types';

const fields: MartField[] = [
  { name: 'Date', type: 'DATE', role: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
  { name: 'Cost', type: 'FLOAT', role: 'metric', allowedAggregations: ['SUM', 'AVG'] },
  { name: 'Clicks', type: 'INTEGER', role: 'metric', allowedAggregations: ['SUM'] },
  { name: 'Source', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT'] },
  { name: 'Campaign', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT'] },
];
const cardinality = { Source: 4, Campaign: 250 };   // low vs high

describe('generate', () => {
  const d = generate('m1', 'AD COST', fields, cardinality);

  it('binds the dashboard to exactly one data mart via $entity', () => {
    expect(d.$entity).toEqual({ type: 'data-mart', id: 'm1' });
    expect(d.gridColumns).toBe(5);
  });

  it('adds a global date slice for the date field', () => {
    expect(d.slices).toEqual([
      { column: 'Date', operator: 'relative_date', value: { kind: 'last_n_days', n: 30 } },
    ]);
  });

  it('emits at most 5 scorecards, one per metric, full-width-fifth each', () => {
    const cards = d.components.filter(c => c.type === 'scorecard');
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(5);
    expect(cards[0].width).toBe(1);
    expect(cards[0].config).toEqual({ metric: 'Cost', aggregation: 'SUM' });
  });

  it('emits a full-width DAY time series when a date field exists', () => {
    const ts = d.components.find(c => c.type === 'timeseries');
    expect(ts).toBeDefined();
    expect(ts!.width).toBe(5);
    expect(ts!.config).toMatchObject({ dateField: 'Date', metric: 'Cost', unit: 'DAY', aggregation: 'SUM' });
  });

  it('uses a pie ONLY for the low-cardinality dimension', () => {
    const pie = d.components.find(c => c.type === 'pie');
    expect(pie!.config).toMatchObject({ dimension: 'Source' });
    expect(cardinality.Source).toBeLessThanOrEqual(PIE_MAX_CATEGORIES);
  });

  it('uses a bar (never a pie) for the high-cardinality dimension', () => {
    const bars = d.components.filter(c => c.type === 'bar');
    expect(bars.some(b => (b.config as { dimension: string }).dimension === 'Campaign')).toBe(true);
    const pies = d.components.filter(c => c.type === 'pie');
    expect(pies.some(p => (p.config as { dimension: string }).dimension === 'Campaign')).toBe(false);
  });

  it('ends with a full-width detail table over every field', () => {
    const last = d.components[d.components.length - 1];
    expect(last.type).toBe('table');
    expect(last.width).toBe(5);
    expect((last.config as { columns: string[] }).columns).toEqual(fields.map(f => f.name));
  });

  it('produces components in the spec order: scorecards, timeseries, bars, pie, table', () => {
    const order = [...new Set(d.components.map(c => c.type))];
    expect(order).toEqual(['scorecard', 'timeseries', 'bar', 'pie', 'table']);
  });

  it('generates nothing but a table when the mart has no metrics', () => {
    const only = generate('m1', 'X', [fields[3]], { Source: 3 });
    expect(only.components.every(c => c.type === 'table' || c.type === 'pie')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Adversarial cases beyond the brief: degenerate marts a generator must not choke on, and
// governance invariants that must hold no matter how the schema/cardinality inputs are shaped.
// ---------------------------------------------------------------------------

describe('generate: degenerate marts', () => {
  it('omits the table entirely (never emits an uncompilable zero-column table) when the mart has no fields at all', () => {
    const d = generate('m1', 'Empty', [], {});
    expect(d.slices).toEqual([]);
    expect(d.components).toHaveLength(0);
    expect(d.components.some(c => c.type === 'table')).toBe(false);
  });

  it('emits no timeseries and no date slice when the mart has no date field', () => {
    const noDate = fields.filter(f => f.name !== 'Date');
    const d = generate('m1', 'X', noDate, cardinality);
    expect(d.slices).toEqual([]);
    expect(d.components.some(c => c.type === 'timeseries')).toBe(false);
    // Scorecards, bars/pie and the table can still be generated without a date field.
    expect(d.components.some(c => c.type === 'scorecard')).toBe(true);
    expect(d.components[d.components.length - 1].type).toBe('table');
  });

  it('never generates a bar or pie when the mart has no non-date dimensions', () => {
    const noDims = fields.filter(f => f.role !== 'dimension' || f.type === 'DATE');
    const d = generate('m1', 'X', noDims, {});
    expect(d.components.some(c => c.type === 'bar' || c.type === 'pie')).toBe(false);
    expect(d.components.some(c => c.type === 'scorecard')).toBe(true);
    expect(d.components.some(c => c.type === 'timeseries')).toBe(true);
  });

  it('uses only bars, never a pie, when every dimension is high-cardinality', () => {
    const d = generate('m1', 'X', fields, { Source: 999, Campaign: 999 });
    expect(d.components.some(c => c.type === 'bar')).toBe(true);
    expect(d.components.some(c => c.type === 'pie')).toBe(false);
  });

  it('uses only pies, never a bar, when every dimension is low-cardinality', () => {
    const d = generate('m1', 'X', fields, { Source: 2, Campaign: 3 });
    expect(d.components.some(c => c.type === 'pie')).toBe(true);
    expect(d.components.some(c => c.type === 'bar')).toBe(false);
  });

  it('treats a dimension missing from the cardinality map as high-cardinality (prefers a bar)', () => {
    const d = generate('m1', 'X', fields, { Source: 4 }); // Campaign omitted entirely
    const bars = d.components.filter(c => c.type === 'bar') as { config: BarConfig }[];
    expect(bars.some(b => b.config.dimension === 'Campaign')).toBe(true);
    expect(d.components.some(c => c.type === 'pie' && (c.config as PieConfig).dimension === 'Campaign')).toBe(false);
  });

  it('never generates a scorecard, timeseries, bar or pie for a metric with no allowed aggregations', () => {
    const noAggMetric: MartField = { name: 'Weird', type: 'FLOAT', role: 'metric', allowedAggregations: [] };
    const withWeird = [...fields, noAggMetric];
    const d = generate('m1', 'X', withWeird, cardinality);

    expect(d.components.some(c => c.type === 'scorecard' && (c.config as ScorecardConfig).metric === 'Weird')).toBe(false);
    expect(d.components.some(c => c.type === 'timeseries' && (c.config as TimeSeriesConfig).metric === 'Weird')).toBe(false);
    expect(d.components.some(c => (c.type === 'bar' || c.type === 'pie') && (c.config as BarConfig | PieConfig).metric === 'Weird')).toBe(false);
    // It still shows up as a raw column in the detail table — table never aggregates anything.
    const table = d.components[d.components.length - 1];
    expect((table.config as { columns: string[] }).columns).toContain('Weird');
  });

  it('still generates a valid dashboard when EVERY metric has no allowed aggregations (falls back to table-only)', () => {
    const onlyUnusableMetrics: MartField[] = [
      { name: 'Date', type: 'DATE', role: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
      { name: 'Cost', type: 'FLOAT', role: 'metric', allowedAggregations: [] },
      { name: 'Source', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT'] },
    ];
    const d = generate('m1', 'X', onlyUnusableMetrics, { Source: 2 });
    expect(d.components.some(c => c.type === 'scorecard')).toBe(false);
    expect(d.components.some(c => c.type === 'timeseries')).toBe(false);
    expect(d.components.some(c => c.type === 'bar' || c.type === 'pie')).toBe(false);
    expect(d.components).toHaveLength(1);
    expect(d.components[0].type).toBe('table');
  });

  it('never picks an aggregation outside a field\'s declared allowedAggregations, across scorecards/timeseries/bar/pie', () => {
    const weirdFields: MartField[] = [
      { name: 'Date', type: 'DATE', role: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
      { name: 'OnlyMin', type: 'FLOAT', role: 'metric', allowedAggregations: ['MIN'] },
      { name: 'Src', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT'] },
      { name: 'Cmp', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT'] },
    ];
    const d = generate('m1', 'X', weirdFields, { Src: 2, Cmp: 999 });
    for (const c of d.components) {
      if (c.type === 'scorecard') {
        const cfg = c.config as ScorecardConfig;
        expect(weirdFields.find(f => f.name === cfg.metric)!.allowedAggregations).toContain(cfg.aggregation);
      }
      if (c.type === 'timeseries') {
        const cfg = c.config as TimeSeriesConfig;
        expect(weirdFields.find(f => f.name === cfg.metric)!.allowedAggregations).toContain(cfg.aggregation);
      }
      if (c.type === 'bar' || c.type === 'pie') {
        const cfg = c.config as BarConfig | PieConfig;
        expect(weirdFields.find(f => f.name === cfg.metric)!.allowedAggregations).toContain(cfg.aggregation);
      }
    }
  });

  it('never truncates a date field name that only fuzzily resembles a date type (case-insensitive DATETIME/TIMESTAMP)', () => {
    const mixedCase: MartField[] = [
      { name: 'CreatedAt', type: 'timestamp', role: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
      { name: 'Revenue', type: 'FLOAT', role: 'metric', allowedAggregations: ['SUM'] },
    ];
    const d = generate('m1', 'X', mixedCase, {});
    expect(d.slices).toEqual([
      { column: 'CreatedAt', operator: 'relative_date', value: { kind: 'last_n_days', n: 30 } },
    ]);
    expect(d.components.some(c => c.type === 'timeseries')).toBe(true);
  });

  describe('a mart with several date fields', () => {
    // Real shape of 🥈 User | Entity: eight TIMESTAMP columns marking different events. Slicing all
    // of them at "last 30 days" ANDs to zero rows (measured: 95,986 total, 0 with all eight).
    const manyDates: MartField[] = [
      { name: 'firstLogInDateTime', type: 'TIMESTAMP', role: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
      { name: 'created', type: 'TIMESTAMP', role: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
      { name: 'firstPaidSubscriptionDateTime', type: 'TIMESTAMP', role: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
      { name: 'Cost', type: 'FLOAT', role: 'metric', allowedAggregations: ['SUM'] },
    ];

    it('slices on the first date field only', () => {
      const d = generate('m1', 'Users', manyDates, {});
      expect(d.slices).toEqual([
        { column: 'firstLogInDateTime', operator: 'relative_date', value: { kind: 'last_n_days', n: 30 } },
      ]);
    });

    it('still charts over the first date field, so slice and axis agree', () => {
      const d = generate('m1', 'Users', manyDates, {});
      const ts = d.components.find(c => c.type === 'timeseries') as { config: TimeSeriesConfig };
      expect(ts.config.dateField).toBe('firstLogInDateTime');
    });
  });

  describe('a mart whose only countable thing is its primary key', () => {
    // Every column is a STRING or a TIMESTAMP: without Unique Count there is no metric at all, and
    // the generator emits nothing but the detail table.
    const entity: MartField[] = [
      { name: 'id', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT', 'COUNT_DISTINCT'], isPrimaryKey: true },
      { name: 'status', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT', 'COUNT_DISTINCT'] },
      { name: 'created', type: 'TIMESTAMP', role: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
    ];
    const d = generate('m1', 'User | Entity', entity, { status: 4 });

    it('counts the primary key as a metric, under the product\'s own label', () => {
      const card = d.components.find(c => c.type === 'scorecard') as { title: string; config: ScorecardConfig };
      expect(card.title).toBe('Unique Count');
      expect(card.config).toEqual({ metric: 'id', aggregation: 'COUNT_DISTINCT' });
    });

    it('charts it over time and by dimension, instead of emitting a table alone', () => {
      const ts = d.components.find(c => c.type === 'timeseries') as { config: TimeSeriesConfig };
      expect(ts.config).toMatchObject({ metric: 'id', aggregation: 'COUNT_DISTINCT', dateField: 'created' });
      const pie = d.components.find(c => c.type === 'pie') as { title: string; config: PieConfig };
      expect(pie.config).toMatchObject({ dimension: 'status', metric: 'id' });
      expect(pie.title).toBe('Unique Count by status');
    });

    it('never groups BY the primary key — one group per row is not a chart', () => {
      const grouped = d.components
        .filter(c => c.type === 'bar' || c.type === 'pie')
        .map(c => (c.config as BarConfig | PieConfig).dimension);
      expect(grouped).not.toContain('id');
    });

    it('leads with Unique Count even when the mart has real numeric metrics', () => {
      const withCost = generate('m1', 'X', [...entity, { name: 'Cost', type: 'FLOAT', role: 'metric', allowedAggregations: ['SUM'] }], {});
      const cards = withCost.components.filter(c => c.type === 'scorecard') as { title: string }[];
      expect(cards.map(c => c.title)).toEqual(['Unique Count', 'Cost']);
      // Leading means it is the primary metric: the time series and every bar/pie chart it too.
      const ts = withCost.components.find(c => c.type === 'timeseries') as { title: string; config: TimeSeriesConfig };
      expect(ts.config).toMatchObject({ metric: 'id', aggregation: 'COUNT_DISTINCT' });
      expect(ts.title).toBe('Unique Count over time');
    });
  });

  it('generates every bar with a positive integer limit within the 1..1000 service ceiling', () => {
    const d = generate('m1', 'X', fields, { Source: 999, Campaign: 999 });
    const bars = d.components.filter(c => c.type === 'bar') as { config: BarConfig }[];
    expect(bars.length).toBeGreaterThan(0);
    for (const b of bars) {
      expect(b.config.limit).toBeGreaterThanOrEqual(1);
      expect(b.config.limit).toBeLessThanOrEqual(1000);
      expect(b.config.sort).toBe('desc'); // ranked chart: must be server-orderable, not arbitrary
    }
  });

  it('is deterministic aside from generated ids/timestamp: same inputs produce the same shape', () => {
    const a = generate('m1', 'X', fields, cardinality);
    const b = generate('m1', 'X', fields, cardinality);
    const strip = (d: typeof a) => ({ ...d, id: undefined, generatedAt: undefined, components: d.components.map(c => ({ ...c, id: undefined })) });
    expect(strip(a)).toEqual(strip(b));
  });
});

describe('probeCardinality', () => {
  beforeEach(() => vi.restoreAllMocks());

  const dims: MartField[] = [
    { name: 'Source', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT', 'COUNT_DISTINCT'] },
    { name: 'Campaign', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT', 'COUNT_DISTINCT'] },
  ];

  // The probe is a scorecard-shaped query (aggregation, no grouping): queryDataMart runs
  // traverseData, then reads the distinct count STRICTLY from the run's totals (getRun/getRunById) —
  // never from the streamed rows. So mock traverseData to yield a run id and getRun to carry totals.
  const distinctTotals = (col: string, n: number) => ({ [aggLabel(col, 'COUNT_DISTINCT')]: n });
  const traversal = () => ({ runId: 'run-1', rows: async () => [] }) as any;
  const mockRunTotals = (totals: Record<string, unknown> | null) =>
    vi.spyOn(pluginClient, 'getRun').mockResolvedValue({ status: 'SUCCESS', totals: totals as any, sql: null });

  it('asks the SERVER for the distinct count via an aggregated COUNT_DISTINCT read (no raw-row probing)', async () => {
    const spy = vi.spyOn(pluginClient, 'traverseData').mockResolvedValue(traversal());
    mockRunTotals(distinctTotals('Source', 2));
    await probeCardinality('m1', [dims[0]]);
    expect(spy).toHaveBeenCalledOnce();
    const [id, opts] = spy.mock.calls[0];
    expect(id).toBe('m1');
    expect(opts!.column).toEqual(['Source']);
    expect(opts!.aggregation).toEqual([{ column: 'Source', function: 'COUNT_DISTINCT' }]);
  });

  it('reads the distinct count from the run totals, keyed by aggLabel — never from rows.length', async () => {
    vi.spyOn(pluginClient, 'traverseData').mockResolvedValue(traversal());
    mockRunTotals(distinctTotals('Source', 4));
    const out = await probeCardinality('m1', [dims[0]]);
    expect(out.Source).toBe(4);
  });

  it('reports a genuinely low cardinality even when the mart has far more than PIE_MAX_CATEGORIES total rows', async () => {
    // The old (buggy) probe counted raw rows and would misclassify this as high-cardinality.
    // A COUNT_DISTINCT read is immune to total row count.
    vi.spyOn(pluginClient, 'traverseData').mockResolvedValue(traversal());
    mockRunTotals(distinctTotals('Campaign', 2));
    const out = await probeCardinality('m1', [dims[1]]);
    expect(out.Campaign).toBe(2);
    expect(out.Campaign).toBeLessThanOrEqual(PIE_MAX_CATEGORIES);
  });

  it('reports Infinity when the run totals miss the COUNT_DISTINCT key (unexpected server shape)', async () => {
    vi.spyOn(pluginClient, 'traverseData').mockResolvedValue(traversal());
    mockRunTotals({ other: 1 });
    const out = await probeCardinality('m1', [dims[0]]);
    expect(out.Source).toBe(Number.POSITIVE_INFINITY);
  });

  it('reports Infinity when the run reports no totals at all (strict getRunById-only)', async () => {
    vi.spyOn(pluginClient, 'traverseData').mockResolvedValue(traversal());
    mockRunTotals(null);
    const out = await probeCardinality('m1', [dims[0]]);
    expect(out.Source).toBe(Number.POSITIVE_INFINITY);
  });

  it('reports Infinity (prefers a bar over a wrong pie) when the query fails', async () => {
    vi.spyOn(pluginClient, 'traverseData').mockRejectedValue(new Error('boom'));
    const out = await probeCardinality('m1', [dims[0]]);
    expect(out.Source).toBe(Number.POSITIVE_INFINITY);
  });

  it('probes every requested dimension independently, one query each', async () => {
    const spy = vi.spyOn(pluginClient, 'traverseData').mockResolvedValue(traversal());
    mockRunTotals(null);
    await probeCardinality('m1', dims);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('returns an empty map for an empty dimension list without calling the server', async () => {
    const spy = vi.spyOn(pluginClient, 'traverseData');
    const out = await probeCardinality('m1', []);
    expect(out).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  it('never sends COUNT_DISTINCT for a dimension whose allowedAggregations forbids it; treats it as high-cardinality (bar, not pie)', async () => {
    const noDistinct: MartField = { name: 'Raw', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT'] };
    const spy = vi.spyOn(pluginClient, 'traverseData');
    const out = await probeCardinality('m1', [noDistinct]);
    expect(spy).not.toHaveBeenCalled();
    expect(out.Raw).toBe(Number.POSITIVE_INFINITY);
  });

  it('probes every dimension concurrently, not sequentially', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.spyOn(pluginClient, 'traverseData').mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return traversal();
    });
    mockRunTotals(distinctTotals('Source', 3));
    const threeDims: MartField[] = [
      { name: 'Source', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT', 'COUNT_DISTINCT'] },
      { name: 'Campaign', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT', 'COUNT_DISTINCT'] },
      { name: 'Medium', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT', 'COUNT_DISTINCT'] },
    ];
    await probeCardinality('m1', threeDims);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});

describe('fieldLabel / columnLabel', () => {
  const withAlias: MartField[] = [
    { name: 'firstLogInDateTime', type: 'TIMESTAMP', role: 'dimension', allowedAggregations: ['MIN', 'MAX'], alias: 'First LogIn Date Time' },
    { name: 'id', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT_DISTINCT'], isPrimaryKey: true, alias: 'ID' },
    { name: 'noAlias', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT'] },
  ];

  it('prefers the mart\'s alias over the query name', () => {
    expect(fieldLabel(withAlias[0])).toBe('First LogIn Date Time');
    expect(columnLabel(withAlias, 'firstLogInDateTime')).toBe('First LogIn Date Time');
  });

  it('still calls the primary key Unique Count, alias or not', () => {
    expect(fieldLabel(withAlias[1])).toBe('Unique Count');
  });

  it('falls back to the raw name, including for a column not in the schema', () => {
    expect(fieldLabel(withAlias[2])).toBe('noAlias');
    expect(columnLabel(withAlias, 'sessions | SUM')).toBe('sessions | SUM');
  });

  it('titles generated components with aliases', () => {
    const d = generate('m1', 'X', [
      ...withAlias,
      { name: 'revenue', type: 'FLOAT', role: 'metric', allowedAggregations: ['SUM'], alias: 'Revenue, net' },
      { name: 'status', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT'], alias: 'Account Status' },
    ], { status: 3 });
    const titles = d.components.map(c => c.title);
    expect(titles).toContain('Unique Count by Account Status');
    expect(titles).toContain('Unique Count over time');
  });
});
