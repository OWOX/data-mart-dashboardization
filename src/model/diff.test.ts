import { applyChanges, diffModels } from './diff';
import type { ClassNode, MetricDef, Model } from '../types';

const metric = (id: string, martId: string, alias: string, f: string, extra: Partial<MetricDef> = {}): MetricDef => ({
  id, martId, alias, measure: { field: f, fn: 'SUM' }, kind: 'flow', dateField: 'day', role: 'critical', source: 'project',
  isUniqueCount: false, format: 'number', currency: null, plan: null, shown: true, forecast: null, ...extra,
});
const cls = (id: string, title: string, depth: number, metricIds: string[], extra: Partial<ClassNode> = {}): ClassNode => ({
  id, martId: id, title, contexts: [], depth, keyMetricId: metricIds[0] ?? null, metricIds, shown: true, ...extra,
});
const base = (): Model => ({
  version: 2, inputHash: 'old', builtAt: 'b', builtBy: 'u', editedAt: null,
  goal: { classId: 'a', metricId: 'a:rev:SUM', goalMartId: 'a', viaFallback: false },
  classes: [cls('a', 'Orders', 0, ['a:rev:SUM', 'a:qty:SUM']), cls('c', 'Customers', 1, ['c:n:SUM'])],
  edges: [{ from: 'a', to: 'c' }],
  metrics: [metric('a:rev:SUM', 'a', 'Revenue', 'rev'), metric('a:qty:SUM', 'a', 'Units', 'qty', { role: 'leading' }), metric('c:n:SUM', 'c', 'Customers', 'n')],
});
const copy = (m: Model): Model => structuredClone(m);

test('a format change is a metric_changed on format, and applies with its currency', () => {
  const cur = base();
  const cand = copy(base());
  cand.metrics[0] = { ...cand.metrics[0]!, format: 'currency', currency: 'EUR' };
  const changes = diffModels(cur, cand);
  expect(changes).toEqual([{ kind: 'metric_changed', classId: 'a', metricId: 'a:rev:SUM', field: 'format', before: 'number', after: 'currency (EUR)' }]);
  expect(applyChanges(cur, cand, changes, 'now').metrics[0]).toMatchObject({ format: 'currency', currency: 'EUR' });
});

test('no differences, no changes', () => expect(diffModels(base(), copy(base()))).toEqual([]));

test('every change kind is found', () => {
  const cand = copy(base());
  cand.classes = [cls('a', 'Orders', 0, ['a:rev:SUM', 'a:new:SUM']), cls('d', 'Deals', 1, ['d:v:SUM'])];
  cand.metrics = [
    metric('a:rev:SUM', 'a', 'Sales', 'rev', { role: 'lagging', kind: 'level', dateField: null, plan: { martId: 'p', measure: { field: 'g', fn: 'SUM' }, dateField: 'day', shape: 'daily' } }),
    metric('a:new:SUM', 'a', 'New', 'new'),
    metric('d:v:SUM', 'd', 'Value', 'v'),
  ];
  cand.edges = [{ from: 'a', to: 'd' }];
  const changes = diffModels(base(), cand);
  expect(changes.map((c) => c.kind === 'metric_changed' ? `changed:${c.field}` : c.kind).sort()).toEqual([
    'changed:alias', 'changed:dateField', 'changed:kind', 'changed:plan', 'changed:role',
    'class_added', 'class_removed', 'metric_added', 'metric_removed',
  ]);
  expect(changes).toContainEqual({ kind: 'metric_changed', classId: 'a', metricId: 'a:rev:SUM', field: 'alias', before: 'Revenue', after: 'Sales' });
  expect(changes).toContainEqual({ kind: 'metric_removed', classId: 'a', metricId: 'a:qty:SUM', alias: 'Units' });
  // the metrics of an added or removed class ride on the class row
  expect(changes.filter((c) => c.kind.startsWith('metric_') && c.classId !== 'a')).toEqual([]);
});

test('a member-edited fact field is one changed row, not a removed and an added metric', () => {
  const cur = base();
  // the member pointed Units at another field; the id stays the stable identity
  cur.metrics[1] = { ...cur.metrics[1]!, measure: { field: 'items', fn: 'SUM' } };
  const cand = copy(base()); // the rebuild still reads qty, under the id a:qty:SUM
  const changes = diffModels(cur, cand);
  expect(changes).toEqual([{ kind: 'metric_changed', classId: 'a', metricId: 'a:qty:SUM', field: 'measure', before: 'items (SUM)', after: 'qty (SUM)' }]);
});

test('an id that no longer matches pairs by Data Mart, field and aggregation, and applies to the existing id', () => {
  const cur = base();
  cur.metrics[1] = { ...cur.metrics[1]!, id: 'a:old:SUM', alias: 'Mine' }; // same measure as the candidate's a:qty:SUM
  cur.classes[0]!.metricIds = ['a:rev:SUM', 'a:old:SUM'];
  const cand = copy(base());
  const changes = diffModels(cur, cand);
  expect(changes).toEqual([{ kind: 'metric_changed', classId: 'a', metricId: 'a:old:SUM', field: 'alias', before: 'Mine', after: 'Units' }]);
  const next = applyChanges(cur, cand, changes, 'now');
  expect(next.metrics.map((m) => m.id)).toEqual(['a:rev:SUM', 'a:old:SUM', 'c:n:SUM']);
  expect(next.metrics[1]!.alias).toBe('Units');
});

test('a subset applies; unpicked changes stay, shown and forecast are preserved', () => {
  const cur = base();
  cur.metrics[0] = { ...cur.metrics[0]!, shown: false, forecast: { martId: 'f', measure: { field: 'x', fn: 'SUM' }, dateField: 'day' } };
  const cand = copy(base());
  cand.metrics[0] = { ...cand.metrics[0]!, alias: 'Sales', role: 'lagging', shown: true };
  cand.metrics[1] = { ...cand.metrics[1]!, alias: 'Pieces' };
  const changes = diffModels(cur, cand);
  const picked = changes.filter((c) => c.kind === 'metric_changed' && c.field === 'alias' && c.metricId === 'a:rev:SUM');
  expect(picked).toHaveLength(1);
  const next = applyChanges(cur, cand, picked, '2026-11-04T10:00:00Z');
  expect(next.metrics[0]).toEqual({ ...cur.metrics[0], alias: 'Sales' }); // role unpicked, shown and forecast kept
  expect(next.metrics[1]!.alias).toBe('Units');
  expect(next.editedAt).toBe('2026-11-04T10:00:00Z');
  expect(cur.metrics[0]!.alias).toBe('Revenue'); // input untouched
});

test('nothing picked changes nothing and keeps editedAt', () => {
  const cur = base();
  expect(applyChanges(cur, copy(cur), [], 'now')).toEqual(cur);
});

test('an added class and metric come in shown with no forecast; edges and goal follow the candidate', () => {
  const cur = base();
  const cand = copy(base());
  cand.classes.push(cls('d', 'Deals', 1, ['d:v:SUM'], { shown: false }));
  cand.metrics.push(metric('d:v:SUM', 'd', 'Value', 'v', { shown: false, forecast: { martId: 'f', measure: { field: 'x', fn: 'SUM' }, dateField: 'day' } }));
  cand.metrics.push(metric('a:new:SUM', 'a', 'New', 'new', { shown: false }));
  cand.classes[0]!.metricIds.push('a:new:SUM');
  cand.edges.push({ from: 'a', to: 'd' });
  const next = applyChanges(cur, cand, diffModels(cur, cand), 'now');
  expect(next.classes.find((c) => c.id === 'd')).toMatchObject({ shown: true, keyMetricId: 'd:v:SUM', metricIds: ['d:v:SUM'] });
  for (const id of ['a:new:SUM', 'd:v:SUM']) expect(next.metrics.find((m) => m.id === id)).toMatchObject({ shown: true, forecast: null });
  expect(next.edges).toEqual([{ from: 'a', to: 'c' }, { from: 'a', to: 'd' }]);
});

test('removing a class drops its edges, and a removed key metric falls back to the first shown one', () => {
  const cur = base();
  cur.metrics[1] = { ...cur.metrics[1]!, shown: false };
  cur.classes[0]!.metricIds = ['a:rev:SUM', 'a:qty:SUM', 'a:z:SUM'];
  cur.metrics.push(metric('a:z:SUM', 'a', 'Z', 'z'));
  const cand = copy(cur);
  cand.classes = cand.classes.filter((c) => c.id !== 'c');
  cand.edges = [];
  cand.metrics = cand.metrics.filter((m) => m.id !== 'c:n:SUM' && m.id !== 'a:rev:SUM');
  cand.classes[0]!.metricIds = ['a:qty:SUM', 'a:z:SUM'];
  cand.classes[0]!.keyMetricId = 'a:z:SUM';
  const next = applyChanges(cur, cand, diffModels(cur, cand), 'now');
  expect(next.classes.map((c) => c.id)).toEqual(['a']);
  expect(next.edges).toEqual([]);
  expect(next.metrics.map((m) => m.id)).toEqual(['a:qty:SUM', 'a:z:SUM']);
  expect(next.classes[0]!.keyMetricId).toBe('a:z:SUM'); // a:rev removed; a:qty is hidden
  expect(next.goal.metricId).toBeNull();
});

test('the goal class is never offered for removal unless the candidate moves the goal to a class that exists', () => {
  const cur = base();
  const cand = copy(base());
  cand.classes = cand.classes.filter((c) => c.id !== 'a');
  cand.metrics = cand.metrics.filter((m) => m.martId !== 'a');
  expect(diffModels(cur, cand).some((c) => c.kind === 'class_removed')).toBe(false);
  cand.goal = { ...cand.goal, classId: 'c', metricId: 'c:n:SUM', goalMartId: 'c' };
  expect(diffModels(cur, cand)).toContainEqual({ kind: 'class_removed', classId: 'a', title: 'Orders' });
});

test('picking only class_added keeps the current goal even when the candidate goal differs', () => {
  const cur = base();
  const cand = copy(base());
  cand.classes.push(cls('d', 'Deals', 1, ['d:v:SUM']));
  cand.metrics.push(metric('d:v:SUM', 'd', 'Value', 'v'));
  cand.goal = { classId: 'd', metricId: 'd:v:SUM', goalMartId: 'd', viaFallback: false };
  const next = applyChanges(cur, cand, diffModels(cur, cand).filter((c) => c.kind === 'class_added'), 'now');
  expect(next.goal).toEqual(cur.goal);
  expect(next.classes.map((c) => c.id)).toContain('d');
});

test('an added class does not duplicate a metric that exists under another id', () => {
  const cur = base();
  cur.metrics[0] = { ...cur.metrics[0]!, id: 'mine' };
  cur.classes[0]!.metricIds = ['mine', 'a:qty:SUM'];
  cur.goal = { ...cur.goal, metricId: 'mine' };
  const cand = copy(base());
  cand.classes.push(cls('d', 'Deals', 1, ['a:rev:SUM', 'd:v:SUM']));
  cand.metrics.push(metric('d:v:SUM', 'd', 'Value', 'v'));
  const next = applyChanges(cur, cand, diffModels(cur, cand).filter((c) => c.kind === 'class_added'), 'now');
  expect(next.metrics.filter((m) => m.measure.field === 'rev')).toHaveLength(1);
  expect(next.classes.find((c) => c.id === 'd')!.metricIds).toEqual(['d:v:SUM']);
});
