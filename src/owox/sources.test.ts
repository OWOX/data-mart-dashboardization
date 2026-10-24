import { fetchBlendable, fetchInputs, fetchMartDetail, flattenFields } from './sources';
import { fakeOwox } from './fake';

const owox = fakeOwox({
  projectDescription: '# Goal',
  contexts: [{ id: 'c1', name: 'Growth', description: { weird: true } as never }],
  marts: [
    { id: 'm1', title: 'Customers', status: 'PUBLISHED', description: null, contexts: [], modifiedAt: 't1' },
    { id: 'm2', title: 'Draft', status: 'DRAFT', description: null, contexts: [], modifiedAt: 't2' },
  ],
  details: { m1: { id: 'm1', title: 'Customers', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }] } },
  blendables: { m1: { availableSources: [], mainUniqueCountKeyFields: ['id'] } },
});

test('fetchInputs keeps published marts and normalises context descriptions', async () => {
  const inputs = await fetchInputs(owox);
  expect(inputs.projectDescription).toBe('# Goal');
  expect(inputs.contexts).toEqual([{ id: 'c1', name: 'Growth', description: null }]);
  expect(inputs.marts.map((m) => m.id)).toEqual(['m1']);
});

test('detail and blendable', async () => {
  expect((await fetchMartDetail(owox, 'm1')).fields[0]!.name).toBe('id');
  expect((await fetchBlendable(owox, 'm1')).mainUniqueCountKeyFields).toEqual(['id']);
});

test('flattenFields builds dotted paths and skips hidden subtrees', () => {
  expect(flattenFields([
    { name: 'a', type: 'RECORD', isPrimaryKey: false, fields: [{ name: 'b', type: 'INTEGER', isPrimaryKey: false }] },
    { name: 'h', type: 'RECORD', isPrimaryKey: false, isHiddenForReporting: true, fields: [{ name: 'x', type: 'STRING', isPrimaryKey: false }] },
  ]).map((f) => f.path)).toEqual(['a', 'a.b']);
});

test('flattenFields skips DISCONNECTED subtrees and does not descend into REPEATED fields', () => {
  expect(flattenFields([
    { name: 'r', type: 'RECORD', isPrimaryKey: false, mode: 'REPEATED', fields: [{ name: 'c', type: 'STRING', isPrimaryKey: false }] },
    { name: 'd', type: 'RECORD', isPrimaryKey: false, status: 'DISCONNECTED', fields: [{ name: 'e', type: 'STRING', isPrimaryKey: false }] },
    { name: 'ok', type: 'STRING', isPrimaryKey: false, status: 'CONNECTED' },
  ]).map((f) => f.path)).toEqual(['r', 'ok']);
});

test('fetchInputs survives a refused /api/contexts', async () => {
  const base = fakeOwox({ projectDescription: 'p', contexts: [], marts: [], details: {}, blendables: {} });
  const refused = { ...base, getJson: async () => { throw new Error('403'); } } as typeof base;
  const inputs = await fetchInputs(refused);
  expect(inputs.contexts).toEqual([]);
  expect(inputs.projectDescription).toBe('p');
});
