import { applyChanges, diffModels, linksDiffer, relink } from './diff';
import type { ClassNode, MetricDef, Model } from '../types';

const metric = (id: string, martId: string, alias: string, f: string, extra: Partial<MetricDef> = {}): MetricDef => ({
  id, martId, alias, measure: { field: f, fn: 'SUM' }, kind: 'flow', dateField: 'day', role: 'critical', source: 'project',
  isUniqueCount: false, format: 'number', currency: null, plan: null, shown: true, forecast: null, ...extra,
});
const cls = (id: string, title: string, depth: number, metricIds: string[], extra: Partial<ClassNode> = {}): ClassNode => ({
  id, martId: id, title, contexts: [], depth, keyMetricId: metricIds[0] ?? null, metricIds, shown: true, core: false, inbound: 0, ...extra,
});
const base = (): Model => ({
  version: 3, inputHash: 'old', builtAt: 'b', builtBy: 'u', editedAt: null, editedBy: null,
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

test('a candidate currency without a code never proposes wiping a typed one', () => {
  const cur = base();
  cur.metrics[0] = { ...cur.metrics[0]!, format: 'currency', currency: 'EUR' };
  const cand = copy(base());
  cand.metrics[0] = { ...cand.metrics[0]!, format: 'currency', currency: null };
  expect(diffModels(cur, cand)).toEqual([]);
  cand.metrics[0] = { ...cand.metrics[0]!, currency: 'GBP' };
  expect(diffModels(cur, cand)).toHaveLength(1);
});

test('no differences, no changes', () => expect(diffModels(base(), copy(base()))).toEqual([]));

test('a stored model with reordered keys or a missing fn proposes nothing', () => {
  const cur = base();
  cur.metrics[0] = { ...cur.metrics[0]!, plan: { martId: 'p', measure: { field: 'g', fn: 'SUM' }, dateField: 'day', shape: 'level' } };
  const cand = copy(cur);
  const stored = JSON.parse(JSON.stringify(cur)) as Model;
  stored.metrics[0] = { ...stored.metrics[0]!, measure: { fn: 'SUM', field: 'rev' }, plan: { shape: 'level', dateField: 'day', measure: { fn: 'SUM', field: 'g' }, martId: 'p' } };
  stored.metrics[1] = { ...stored.metrics[1]!, measure: { field: 'qty', fn: null } };
  cand.metrics[1] = { ...cand.metrics[1]!, measure: { field: 'qty' } as MetricDef['measure'] };
  expect(diffModels(stored, cand)).toEqual([]);
});

test('a plan that differs only in shape, aggregation or Data Mart is still a change', () => {
  const plan = { martId: 'p', measure: { field: 'g', fn: 'SUM' as const }, dateField: 'day', shape: 'daily' as const };
  const cur = base();
  cur.metrics[0] = { ...cur.metrics[0]!, plan };
  for (const next of [{ ...plan, shape: 'level' as const }, { ...plan, measure: { field: 'g', fn: 'MAX' as const } }, { ...plan, martId: 'q' }]) {
    const cand = copy(cur);
    cand.metrics[0] = { ...cand.metrics[0]!, plan: next };
    expect(diffModels(cur, cand).map((c) => c.kind === 'metric_changed' && c.field)).toEqual(['plan']);
  }
});

test('every change kind is found', () => {
  const cand = copy(base());
  cand.classes = [cls('a', 'Orders', 0, ['a:rev:SUM', 'a:new:SUM']), cls('d', 'Deals', 1, ['d:v:SUM'])];
  cand.metrics = [
    metric('a:rev:SUM', 'a', 'Sales', 'rev', { kind: 'level', dateField: null, plan: { martId: 'p', measure: { field: 'g', fn: 'SUM' }, dateField: 'day', shape: 'daily' } }),
    metric('a:new:SUM', 'a', 'New', 'new'),
    metric('d:v:SUM', 'd', 'Value', 'v'),
  ];
  cand.edges = [{ from: 'a', to: 'd' }];
  const changes = diffModels(base(), cand);
  expect(changes.map((c) => c.kind === 'metric_changed' ? `changed:${c.field}` : c.kind).sort()).toEqual([
    'changed:dateField', 'changed:kind', 'changed:plan',
    'class_added', 'class_removed', 'metric_added', 'metric_removed',
  ]);
  // names follow the Data Mart's fields, so a different alias is never a change
  expect(changes.some((c) => c.kind === 'metric_changed' && (c.field as string) === 'alias')).toBe(false);
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
  cand.metrics[1] = { ...cand.metrics[1]!, kind: 'level' };
  const changes = diffModels(cur, cand);
  expect(changes).toEqual([{ kind: 'metric_changed', classId: 'a', metricId: 'a:old:SUM', field: 'kind', before: 'flow', after: 'level' }]);
  const next = applyChanges(cur, cand, changes, 'now');
  expect(next.metrics.map((m) => m.id)).toEqual(['a:rev:SUM', 'a:old:SUM', 'c:n:SUM']);
  expect(next.metrics[1]).toMatchObject({ alias: 'Mine', kind: 'level' });
});

test('a subset applies; unpicked changes stay, shown and forecast are preserved', () => {
  const cur = base();
  cur.metrics[0] = { ...cur.metrics[0]!, shown: false, forecast: { martId: 'f', measure: { field: 'x', fn: 'SUM' }, dateField: 'day' } };
  const cand = copy(base());
  cand.metrics[0] = { ...cand.metrics[0]!, kind: 'level', shown: true };
  cand.metrics[1] = { ...cand.metrics[1]!, kind: 'level' };
  const changes = diffModels(cur, cand);
  const picked = changes.filter((c) => c.kind === 'metric_changed' && c.field === 'kind' && c.metricId === 'a:rev:SUM');
  expect(picked).toHaveLength(1);
  const next = applyChanges(cur, cand, picked, '2026-11-04T10:00:00Z');
  expect(next.metrics[0]).toEqual({ ...cur.metrics[0], kind: 'level' }); // shown and forecast kept
  expect(next.metrics[1]!.kind).toBe('flow');
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

test('a rebuild keeps the member\'s order, appends new metrics, and the key is the first shown one', () => {
  const cur = base();
  cur.classes[0]!.metricIds = ['a:qty:SUM', 'a:rev:SUM'];
  cur.classes[0]!.keyMetricId = 'a:qty:SUM';
  const cand = copy(base()); // the build's own order: rev first
  cand.metrics.push(metric('a:new:SUM', 'a', 'New', 'new'));
  cand.classes[0]!.metricIds = ['a:new:SUM', 'a:rev:SUM', 'a:qty:SUM'];
  const next = applyChanges(cur, cand, diffModels(cur, cand), 'now');
  expect(next.classes[0]!.metricIds).toEqual(['a:qty:SUM', 'a:rev:SUM', 'a:new:SUM']);
  expect(next.classes[0]!.keyMetricId).toBe('a:qty:SUM');
});

test('a new ref between two classes already in the model is drawn and reorders the cards on apply', () => {
  const cur = base();
  cur.classes.push(cls('d', 'Deals', 1, ['d:v:SUM']));
  cur.metrics.push(metric('d:v:SUM', 'd', 'Value', 'v'));
  cur.edges.push({ from: 'a', to: 'd' });
  const cand = copy(cur);
  cand.edges = [{ from: 'a', to: 'd', fields: ['rate'] }, { from: 'd', to: 'c' }];
  cand.metrics.push(metric('a:new:SUM', 'a', 'New', 'new'));
  cand.classes[0]!.metricIds.push('a:new:SUM');
  const next = applyChanges(cur, cand, diffModels(cur, cand), 'now');
  expect(next.edges).toEqual([{ from: 'a', to: 'd', fields: ['rate'] }, { from: 'd', to: 'c' }]);
  expect(next.classes.map((c) => [c.id, c.depth])).toEqual([['a', 0], ['c', 2], ['d', 1]]);
});

test('a class the member kept but the candidate lacks keeps its edges', () => {
  const cur = base();
  const cand = copy(cur);
  cand.classes = cand.classes.filter((c) => c.id !== 'c');
  cand.metrics = cand.metrics.filter((m) => m.id !== 'c:n:SUM');
  cand.edges = [];
  cand.metrics.push(metric('a:new:SUM', 'a', 'New', 'new'));
  cand.classes[0]!.metricIds.push('a:new:SUM');
  const picked = diffModels(cur, cand).filter((c) => c.kind !== 'class_removed');
  expect(applyChanges(cur, cand, picked, 'now').edges).toEqual([{ from: 'a', to: 'c' }]);
});

test('relink: edges between known classes follow the candidate, and linksDiffer sees it', () => {
  const cur = base();
  const cand = copy(cur);
  cand.edges = [{ from: 'a', to: 'c' }, { from: 'c', to: 'a' }];
  const next = relink(cur, cand);
  expect(next.edges).toEqual(cand.edges);
  expect(linksDiffer(cur, next)).toBe(true);
  expect(linksDiffer(cur, relink(cur, copy(cur)))).toBe(false);
  // order alone is no difference
  expect(linksDiffer({ ...cur, edges: [{ from: 'x', to: 'y' }, { from: 'a', to: 'c' }] }, { ...cur, edges: [{ from: 'a', to: 'c' }, { from: 'x', to: 'y' }] })).toBe(false);
});

test('nothing picked still redraws lines that moved, and keeps editedAt so the cache stays', () => {
  const cur = base();
  const cand = copy(cur);
  cand.edges = [{ from: 'a', to: 'c', fields: ['rate'] }];
  const next = applyChanges(cur, cand, [], 'now');
  expect(next.edges).toEqual([{ from: 'a', to: 'c', fields: ['rate'] }]);
  expect(next.editedAt).toBeNull();
  expect(next.metrics).toEqual(cur.metrics);
});

test('a class the member declined bridges the two classes it links, so their line stays (dashed on the canvas)', () => {
  const cur = base(); // a -> c
  const cand = copy(cur);
  cand.classes.push(cls('b', 'Bridge', 1, ['b:v:SUM']));
  cand.metrics.push(metric('b:v:SUM', 'b', 'V', 'v'));
  cand.edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'b', to: 'x' }];
  cand.classes.push(cls('x', 'Leaf', 2, []));
  const next = applyChanges(cur, cand, [], 'now');
  expect(next.edges).toEqual([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]);
  expect(next.classes.map((c) => [c.id, c.depth])).toEqual([['a', 0], ['c', 2]]);
  // once the class is added, its edges are ordinary ones
  const added = applyChanges(cur, cand, diffModels(cur, cand).filter((c) => c.kind === 'class_added' && c.classId === 'b'), 'now');
  expect(added.edges).toEqual([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]);
});
