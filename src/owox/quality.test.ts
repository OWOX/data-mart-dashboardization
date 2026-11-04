import { fetchQuality } from './quality';
import { fakeOwox } from './fake';

const base = { projectDescription: null, contexts: [], marts: [], details: {}, blendables: {} };

test('without postJson, or on failure, there is nothing', async () => {
  expect(await fetchQuality(fakeOwox(base), ['a'])).toBeNull();
  expect(await fetchQuality(fakeOwox({ ...base, quality: () => { throw new Error('x'); } }), ['a'])).toBeNull();
});

test('items are keyed by Data Mart id', async () => {
  const s = { state: 'PASSED' };
  const m = await fetchQuality(fakeOwox({ ...base, quality: () => ({ items: [{ dataMartId: 'a', summary: s }, { dataMartId: 'b' }] }) }), ['a', 'b']);
  expect([...m!.keys()]).toEqual(['a']);
});
