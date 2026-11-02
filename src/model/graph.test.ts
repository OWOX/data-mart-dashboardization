import { buildEdges, chooseMain, classDepths, hasPrimaryKey, type MartNode } from './graph';

const field = (name: string, formula?: string, pk = false) => ({ name, type: 'FLOAT', isPrimaryKey: pk, ...(formula ? { calculated: { formula } } : {}) });
const src = (aliasPath: string, dataMartId: string, ok = true) => ({ aliasPath, dataMartId, title: dataMartId, isAccessibleForReporting: ok });
const node = (id: string, fields: ReturnType<typeof field>[], sources: ReturnType<typeof src>[] = []): MartNode => ({
  id, title: id.toUpperCase(), contexts: [], detail: { id, title: id.toUpperCase(), fields }, blendable: { availableSources: sources, mainUniqueCountKeyFields: [] },
});

const nodes = [
  node('orders', [field('id', undefined, true), field('rev', `SUM({{ref field="amount"}})`), field('ltv', `AVG({{ ref path='customers' field='ltv' }})`)], [src('customers', 'customers')]),
  node('customers', [field('id', undefined, true), field('x', `SUM({{ref path="secret.pages" field="views"}})`)], [src('secret', 'secret'), src('secret.pages', 'pages')]),
  node('pages', [field('id', undefined, true)]),
];

test('edges come from calculated refs with a path; hidden hops break them', () => {
  const visible = new Set(['orders', 'customers', 'pages']);
  expect(buildEdges(nodes, visible)).toEqual([{ from: 'orders', to: 'customers', refFields: ['ltv'], fields: ['ltv'] }]);
});

test('main is the goal mart when visible', () => {
  expect(chooseMain({ goalMartId: 'orders', goalField: 'rev', nodes, visible: new Set(['orders', 'customers']) })).toEqual({ id: 'orders', viaFallback: false });
});

test('hidden goal falls back to the nearest visible mart, preferring one that references the goal field', () => {
  const ns = [
    node('a', [field('k', `SUM({{ref path="g" field="arr"}})`)], [src('g', 'goal')]),
    node('b', [field('k', `SUM({{ref path="g" field="other"}})`)], [src('g', 'goal')]),
  ];
  expect(chooseMain({ goalMartId: 'goal', goalField: 'arr', nodes: ns, visible: new Set(['a', 'b']) })).toEqual({ id: 'a', viaFallback: true });
  expect(chooseMain({ goalMartId: 'goal', goalField: 'zzz', nodes: ns, visible: new Set(['a', 'b']) })).toEqual({ id: 'a', viaFallback: true });
  expect(chooseMain({ goalMartId: 'goal', goalField: 'arr', nodes: [], visible: new Set() })).toBeNull();
});

test('depths follow edges and skip marts without a primary key', () => {
  const edges = [{ from: 'm', to: 'a' }, { from: 'a', to: 'b' }, { from: 'm', to: 'nopk' }, { from: 'nopk', to: 'c' }];
  expect([...classDepths('m', edges, new Set(['a', 'b', 'c']))]).toEqual([['m', 0], ['a', 1], ['b', 2]]);
});

test('hasPrimaryKey looks at nested fields too', () => {
  expect(hasPrimaryKey({ id: 'x', title: 'X', fields: [{ name: 'r', type: 'RECORD', isPrimaryKey: false, fields: [{ name: 'k', type: 'STRING', isPrimaryKey: true }] }] })).toBe(true);
  expect(hasPrimaryKey({ id: 'x', title: 'X', fields: [] })).toBe(false);
});
