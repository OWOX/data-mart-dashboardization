import { cacheKey, persistable, refreshCanvas, trimToSize } from './refresh';
import { fakeOwox } from '../owox/fake';
import { addDays, rangeFor } from '../lib/dates';
import type { CacheDoc, Model } from '../types';

test('refresh fills every card and reports progress', async () => {
  const owox = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {}, rows: () => [{ 'id | COUNTUNIQUE': 5, date: '2026-10-20' }] });
  const model: Model = {
    version: 2, inputHash: 'h1', builtAt: '', builtBy: 'u', editedAt: null,
    goal: { classId: 'a', metricId: null, goalMartId: 'a', viaFallback: false },
    classes: [
      { id: 'a', martId: 'a', title: 'A', contexts: [], depth: 0, keyMetricId: 'a:id:COUNT_DISTINCT', metricIds: ['a:id:COUNT_DISTINCT'], shown: true },
      { id: 'b', martId: 'b', title: 'B', contexts: [], depth: 1, keyMetricId: null, metricIds: [], shown: true },
    ],
    edges: [{ from: 'a', to: 'b' }],
    metrics: [{ id: 'a:id:COUNT_DISTINCT', martId: 'a', alias: 'A', measure: { field: 'id', fn: 'COUNT_DISTINCT' }, kind: 'flow', dateField: 'date', role: 'unique', source: 'schema', isUniqueCount: true, plan: null, shown: true, forecast: null }],
  };
  const progress: number[] = [];
  const doc = await refreshCanvas({ owox, model, spec: rangeFor('last_7d', new Date('2026-10-24T10:00:00Z')), key: 'k', thresholdPct: 20, onProgress: (d) => progress.push(d) });
  expect(doc.modelHash).toBe('h1');
  expect(doc.builtAt).toBe('');
  expect(doc.thresholdPct).toBe(20);
  expect(doc.anchor).toBe('2026-10-23');
  expect(doc.cards.a!.metrics['a:id:COUNT_DISTINCT']!.fact).toBe(5);
  expect(doc.cards.b).toEqual({ metrics: {}, spark: null });
  expect(progress).toEqual([0, 1]);
  expect(doc.key).toBe('k');
});

test('classes outside the visible set are not queried and get no card', async () => {
  const owox = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {}, rows: () => [{ 'id | COUNTUNIQUE': 5 }] });
  const metric = (martId: string) => ({ id: `${martId}:id:COUNT_DISTINCT`, martId, alias: martId, measure: { field: 'id', fn: 'COUNT_DISTINCT' as const }, kind: 'flow' as const, dateField: null, role: 'unique' as const, source: 'schema', isUniqueCount: true, plan: null, shown: true, forecast: null });
  const model: Model = {
    version: 2, inputHash: 'h1', builtAt: '', builtBy: 'u', editedAt: null,
    goal: { classId: 'a', metricId: null, goalMartId: 'a', viaFallback: false },
    classes: ['a', 'b'].map((id, depth) => ({ id, martId: id, title: id, contexts: [], depth, keyMetricId: `${id}:id:COUNT_DISTINCT`, metricIds: [`${id}:id:COUNT_DISTINCT`], shown: true })),
    edges: [{ from: 'a', to: 'b' }],
    metrics: [metric('a'), metric('b')],
  };
  const doc = await refreshCanvas({ owox, model, spec: rangeFor('last_7d', new Date('2026-10-24T10:00:00Z')), key: 'k', thresholdPct: 20, visibleIds: new Set(['a']) });
  expect(Object.keys(doc.cards)).toEqual(['a']);
  expect(owox.calls.filter((c) => c.path === 'traverse:b')).toHaveLength(0);
});

test('spark values and forecast are rounded to 4 significant digits', async () => {
  const owox = fakeOwox({
    projectDescription: null, contexts: [], marts: [], details: {}, blendables: {},
    rows: (_id, o) => {
      const f = o.filter as { value: string }[];
      if (!o.dateTrunc) return [{ 'id | COUNTUNIQUE': 123456.789 }];
      const out = [];
      for (let d = f[0]!.value, i = 0; d < f[1]!.value; d = addDays(d, 1), i++) out.push({ date: d, 'id | COUNTUNIQUE': 1234.56789 + i * 0.001 });
      return out;
    },
  });
  const model: Model = {
    version: 2, inputHash: 'h1', builtAt: '', builtBy: 'u', editedAt: null,
    goal: { classId: 'a', metricId: null, goalMartId: 'a', viaFallback: false },
    classes: [{ id: 'a', martId: 'a', title: 'A', contexts: [], depth: 0, keyMetricId: 'a:id:COUNT_DISTINCT', metricIds: ['a:id:COUNT_DISTINCT'], shown: true }],
    edges: [],
    metrics: [{ id: 'a:id:COUNT_DISTINCT', martId: 'a', alias: 'A', measure: { field: 'id', fn: 'COUNT_DISTINCT' }, kind: 'flow', dateField: 'date', role: 'unique', source: 'schema', isUniqueCount: true, plan: null, shown: true, forecast: null }],
  };
  const doc = await refreshCanvas({ owox, model, spec: { ...rangeFor('this_month', new Date('2026-10-24T10:00:00Z')), comparison: null, compareFact: null }, key: 'k', thresholdPct: 20 });
  const spark = doc.cards.a!.spark!;
  expect(spark.values.length).toBeGreaterThan(0);
  expect(spark.forecast.length).toBeGreaterThan(0);
  const sig = (n: number) => Number(n.toPrecision(4));
  for (const v of [...spark.values, ...spark.forecast]) if (v !== null) expect(v).toBe(sig(v));
  expect(spark.values[0]).toBe(1235);
});

test('an oversized cache doc drops every spark', () => {
  const spark = { start: '2026-10-01', values: [1, 2, 3], forecastStart: null, forecast: [] };
  const doc = { cards: { a: { metrics: {}, spark }, b: { metrics: {}, spark } } } as unknown as CacheDoc;
  expect(trimToSize(doc, 10_000)).toBe(doc);
  const trimmed = trimToSize(doc, 50);
  expect(trimmed.cards.a!.spark).toBeNull();
  expect(trimmed.cards.b!.spark).toBeNull();
});

test('cacheKey and persistable: presets persist per key, custom choices do not', () => {
  const q = { kind: 'preset', preset: 'this_quarter' } as const;
  const prev = { kind: 'preset', preset: 'previous_period' } as const;
  const win = { from: '2026-10-01', to: '2026-10-31' };
  expect(cacheKey(q, prev)).toBe('this_quarter:previous_period');
  expect(cacheKey(q, { kind: 'off' })).toBe('this_quarter:off');
  expect(cacheKey({ kind: 'custom', window: win }, { kind: 'custom', window: win })).toBe('c:2026-10-01_2026-10-31:c:2026-10-01_2026-10-31');
  expect(persistable(q, prev)).toBe(true);
  expect(persistable(q, { kind: 'off' })).toBe(true);
  expect(persistable({ kind: 'custom', window: win }, prev)).toBe(false);
  expect(persistable(q, { kind: 'custom', window: win })).toBe(false);
});

test('cacheKey carries a Sunday week start for week presets only', () => {
  const off = { kind: 'off' } as const;
  const w = { kind: 'preset', preset: 'last_week' } as const;
  const q = { kind: 'preset', preset: 'this_quarter' } as const;
  expect(cacheKey(w, off)).toBe('last_week:off');
  expect(cacheKey(w, off, 'monday')).toBe('last_week:off');
  expect(cacheKey(w, off, 'sunday')).toBe('last_week:off:sun');
  expect(cacheKey(q, off, 'sunday')).toBe('this_quarter:off');
});

test('onPartial reports growing card sets; the spark arrives with the key metric', async () => {
  const base = fakeOwox({
    projectDescription: null, contexts: [], marts: [], details: {}, blendables: {},
    rows: (_id, o) => (o.dateTrunc ? [{ date: '2026-10-20', 'id | COUNTUNIQUE': 5 }] : [{ 'id | COUNTUNIQUE': 5 }]),
  });
  // the key metric's mart answers late, so the other metric of its card always lands first
  const owox = { ...base, dataMarts: { ...base.dataMarts, traverseData: async (...a: Parameters<typeof base.dataMarts.traverseData>) => { if (a[0] === 'a') await new Promise((r) => setTimeout(r, 20)); return base.dataMarts.traverseData(...a); } } };
  const metric = (id: string, martId: string) => ({ id, martId, alias: id, measure: { field: 'id', fn: 'COUNT_DISTINCT' as const }, kind: 'flow' as const, dateField: 'date', role: 'unique' as const, source: 'schema', isUniqueCount: true, plan: null, shown: true, forecast: null });
  const model: Model = {
    version: 2, inputHash: 'h1', builtAt: '', builtBy: 'u', editedAt: null,
    goal: { classId: 'a', metricId: null, goalMartId: 'a', viaFallback: false },
    classes: [
      { id: 'a', martId: 'a', title: 'A', contexts: [], depth: 0, keyMetricId: 'k', metricIds: ['k', 'x'], shown: true },
      { id: 'b', martId: 'b', title: 'B', contexts: [], depth: 1, keyMetricId: null, metricIds: ['y'], shown: true },
    ],
    edges: [{ from: 'a', to: 'b' }],
    metrics: [metric('k', 'a'), metric('x', 'x'), metric('y', 'b')],
  };
  const seen: Record<string, import('../types').CardCache>[] = [];
  await refreshCanvas({ owox, model, spec: rangeFor('last_7d', new Date('2026-10-24T10:00:00Z')), key: 'k', thresholdPct: 20, onPartial: (c) => seen.push(structuredClone(c)) });
  expect(seen).toHaveLength(3);
  expect(seen.map((c) => Object.keys(c).length)).toEqual([...seen.map((c) => Object.keys(c).length)].sort());
  expect(Object.keys(seen[2]!).sort()).toEqual(['a', 'b']);
  const first = seen[0]!;
  const id = Object.keys(first)[0]!;
  expect(Object.keys(first[id]!.metrics)).toHaveLength(1);
  // a card with only its non-key metric done has no spark yet
  const withoutKey = seen.find((c) => c.a && !c.a.metrics.k);
  expect(withoutKey).toBeDefined();
  expect(withoutKey!.a!.spark).toBeNull();
  const withKey = seen.find((c) => c.a?.metrics.k)!;
  expect(withKey.a!.spark).not.toBeNull();
});

test('a hidden class and a hidden metric are not queried', async () => {
  const owox = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {}, rows: () => [{ 'id | COUNTUNIQUE': 5, date: '2026-10-20' }] });
  const mt = (id: string, martId: string, shown: boolean) => ({ id, martId, alias: id, measure: { field: id, fn: 'COUNT_DISTINCT' as const }, kind: 'flow' as const, dateField: 'date', role: 'unique' as const, source: 'schema', isUniqueCount: true, plan: null, shown, forecast: null });
  const model: Model = {
    version: 2, inputHash: 'h1', builtAt: '', builtBy: 'u', editedAt: '2026-11-04T00:00:00Z',
    goal: { classId: 'a', metricId: null, goalMartId: 'a', viaFallback: false },
    classes: [
      { id: 'a', martId: 'a', title: 'A', contexts: [], depth: 0, keyMetricId: 'a:hid', metricIds: ['a:hid', 'a:ok'], shown: true },
      { id: 'b', martId: 'b', title: 'B', contexts: [], depth: 1, keyMetricId: 'b:ok', metricIds: ['b:ok'], shown: false },
    ],
    edges: [{ from: 'a', to: 'b' }],
    metrics: [mt('a:hid', 'a', false), mt('a:ok', 'a', true), mt('b:ok', 'b', true)],
  };
  const doc = await refreshCanvas({ owox, model, spec: rangeFor('last_7d', new Date('2026-10-24T10:00:00Z')), key: 'k', thresholdPct: 20 });
  expect(Object.keys(doc.cards)).toEqual(['a']);
  expect(Object.keys(doc.cards.a!.metrics)).toEqual(['a:ok']);
  expect(doc.editedAt).toBe('2026-11-04T00:00:00Z');
  const traversed = owox.calls.filter((c) => c.path.startsWith('traverse:'));
  expect(traversed.length).toBeGreaterThan(0);
  expect(traversed.every((c) => c.path === 'traverse:a')).toBe(true);
});

describe('broken references', () => {
  const metric = (id: string, over = {}) => ({ id, martId: 'a', alias: id, measure: { field: 'id', fn: 'COUNT_DISTINCT' as const }, kind: 'flow' as const, dateField: null, role: 'unique' as const, source: 'schema', isUniqueCount: true, plan: null, shown: true, forecast: null, ...over });
  const model = (metrics: ReturnType<typeof metric>[]): Model => ({
    version: 2, inputHash: 'h1', builtAt: '', builtBy: 'u', editedAt: null,
    goal: { classId: 'a', metricId: null, goalMartId: 'a', viaFallback: false },
    classes: [{ id: 'a', martId: 'a', title: 'A', contexts: [], depth: 0, keyMetricId: metrics[0]!.id, metricIds: metrics.map((m) => m.id), shown: true }],
    edges: [], metrics,
  });
  const spec = rangeFor('last_7d', new Date('2026-10-24T10:00:00Z'));
  const ok = () => fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {}, rows: () => [{ 'id | COUNTUNIQUE': 5 }] });

  test('a metric with a broken fact field is not queried; the others are', async () => {
    const owox = ok();
    const m = model([metric('bad'), metric('good')]);
    const doc = await refreshCanvas({ owox, model: m, spec, key: 'k', thresholdPct: 20, issues: [{ kind: 'fact_field_missing', classId: 'a', martId: 'a', metricId: 'bad', text: 'Field id no longer exists in A' }] });
    const r = doc.cards.a!.metrics;
    expect(r.bad).toMatchObject({ fact: null, status: 'neutral', warning: 'Field id no longer exists in A' });
    expect(r.good!.fact).toBe(5);
    expect(owox.calls.filter((c) => c.path === 'traverse:a')).toHaveLength(1);
  });

  test('a class whose Data Mart is gone queries nothing', async () => {
    const owox = ok();
    const doc = await refreshCanvas({ owox, model: model([metric('m')]), spec, key: 'k', thresholdPct: 20, issues: [{ kind: 'mart_missing', classId: 'a', martId: 'a', metricId: null, text: 'Data Mart not found or not accessible' }] });
    expect(doc.cards.a!.metrics.m!.warning).toBe('Data Mart not found or not accessible');
    expect(owox.calls).toHaveLength(0);
  });

  test('a plan issue drops the plan and warns; the fact stays', async () => {
    const plan = { martId: 'p', measure: { field: 'x', fn: 'SUM' as const }, dateField: 'd', shape: 'daily' as const };
    const owox = ok();
    const doc = await refreshCanvas({ owox, model: model([metric('m', { plan })]), spec, key: 'k', thresholdPct: 20, issues: [{ kind: 'plan_field_missing', classId: 'a', martId: 'a', metricId: 'm', text: 'The plan field x no longer exists in p' }] });
    expect(doc.cards.a!.metrics.m).toMatchObject({ fact: 5, plan: null, warning: 'The plan field x no longer exists in p' });
    expect(owox.calls.some((c) => c.path === 'traverse:p')).toBe(false);
  });

  test('a traverse that throws Not found mid-refresh gives a warning, and the run carries on', async () => {
    const owox = ok();
    const base = owox.dataMarts.traverseData;
    owox.dataMarts.traverseData = async (id, o) => {
      if (id === 'gone') throw new Error('Not found');
      return base(id, o);
    };
    const m = model([metric('bad', { martId: 'gone' }), metric('good')]);
    const doc = await refreshCanvas({ owox, model: m, spec, key: 'k', thresholdPct: 20 });
    expect(doc.cards.a!.metrics.bad).toMatchObject({ fact: null, warning: 'Not found' });
    expect(doc.cards.a!.metrics.good!.fact).toBe(5);
  });

  test('a failed forecast source and a soft issue show as one joined warning', async () => {
    const plan = { martId: 'p', measure: { field: 'x', fn: 'SUM' as const }, dateField: 'd', shape: 'daily' as const };
    const forecast = { martId: 'f', measure: { field: 'id', fn: 'COUNT_DISTINCT' as const }, dateField: 'date' };
    const owox = ok();
    const base = owox.dataMarts.traverseData;
    owox.dataMarts.traverseData = async (id, o) => {
      if (id === 'f') throw new Error('BOOM');
      return base(id, o);
    };
    const m = model([metric('m', { dateField: 'date', plan, forecast })]);
    const future = rangeFor('this_quarter', new Date('2026-10-24T10:00:00Z'));
    const doc = await refreshCanvas({ owox, model: m, spec: future, key: 'k', thresholdPct: 20, issues: [{ kind: 'plan_field_missing', classId: 'a', martId: 'a', metricId: 'm', text: 'The plan field x no longer exists in p' }] });
    expect(doc.cards.a!.metrics.m!.warning).toBe('The plan field x no longer exists in p; Forecast source failed: BOOM');
  });
});

test('a unique count on an INTEGER key is hidden from the canvas and sends no query', async () => {
  const owox = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {}, rows: () => [{ 'qty | SUM': 5, date: '2026-10-20' }] });
  const mt = (id: string, field: string, fn: 'SUM' | 'COUNT_DISTINCT') => ({ id, martId: 'a', alias: id, measure: { field, fn }, kind: 'flow' as const, dateField: 'date', role: 'unique' as const, source: 'schema', isUniqueCount: fn === 'COUNT_DISTINCT', plan: null, shown: true, forecast: null });
  const model: Model = {
    version: 2, inputHash: 'h1', builtAt: '', builtBy: 'u', editedAt: null,
    goal: { classId: 'a', metricId: null, goalMartId: 'a', viaFallback: false },
    classes: [{ id: 'a', martId: 'a', title: 'A', contexts: [], depth: 0, keyMetricId: 'a:id', metricIds: ['a:id', 'a:qty'], shown: true }],
    edges: [], metrics: [mt('a:id', 'id', 'COUNT_DISTINCT'), mt('a:qty', 'qty', 'SUM')],
  };
  const details = new Map([['a', { id: 'a', title: 'A', fields: [{ name: 'id', type: 'INTEGER', isPrimaryKey: true }, { name: 'qty', type: 'FLOAT', isPrimaryKey: false }, { name: 'date', type: 'DATE', isPrimaryKey: false }] }]]);
  const doc = await refreshCanvas({ owox, model, details, spec: rangeFor('last_7d', new Date('2026-10-24T10:00:00Z')), key: 'k', thresholdPct: 20 });
  expect(Object.keys(doc.cards.a!.metrics)).toEqual(['a:qty']);
  const sent = JSON.stringify(owox.calls.filter((c) => c.path.startsWith('traverse:')));
  expect(sent).not.toContain('COUNT_DISTINCT');
  expect(model.metrics[0]!.shown).toBe(true);
});
