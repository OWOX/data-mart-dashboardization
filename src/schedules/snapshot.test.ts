import { SCHEDULE_MODELS, martIdsOf, readSnapshot, writeSnapshot, type ModelSlice } from './snapshot';
import { memoryCollections } from '../store/collections';
import { model as fixtureModel } from '../test/fixtures';

test('a snapshot is one doc per Data Mart, bound to it, and reads back the same classes and metrics', async () => {
  const store = memoryCollections();
  const m = fixtureModel;
  const ids = await writeSnapshot(store, m, 'u1');
  expect(ids).toEqual(martIdsOf(m));
  for (const id of ids) {
    const doc = (await store.collections<ModelSlice>(SCHEDULE_MODELS).get(`u1:${id}`))!.document;
    expect(doc.classes.every((c) => c.martId === id)).toBe(true);
    expect(doc.metrics.every((x) => x.martId === id)).toBe(true);
    expect(store.parentOf(SCHEDULE_MODELS, `u1:${id}`)).toBe(id);
  }
  const back = (await readSnapshot(store, 'u1', ids))!;
  expect(back.classes.map((c) => c.id).sort()).toEqual(m.classes.map((c) => c.id).sort());
  expect(back.metrics.map((x) => x.id).sort()).toEqual(m.metrics.filter((x) => ids.includes(x.martId)).map((x) => x.id).sort());
});

test('missing slices are skipped; none at all is null', async () => {
  const store = memoryCollections();
  const ids = await writeSnapshot(store, fixtureModel, 'u1');
  expect(await readSnapshot(store, 'u2', ids)).toBeNull();
  const one = await readSnapshot(store, 'u1', [ids[0]!, 'gone']);
  expect(one!.classes.map((c) => c.martId)).toEqual([ids[0]]);
});

test('a hidden goal class that is not the first class stays the goal', async () => {
  const store = memoryCollections();
  const base = fixtureModel.classes[0]!;
  const first = { ...base, id: 'c1', martId: 'a' };
  const goal = { ...base, id: 'c2', martId: 'b', shown: false };
  const m = { ...fixtureModel, goal: { ...fixtureModel.goal, classId: 'c2', goalMartId: 'b' }, classes: [first, goal] };
  const ids = await writeSnapshot(store, m, 'u1');
  const back = (await readSnapshot(store, 'u1', ids))!;
  expect(back.goal.classId).toBe('c2');
  expect(back.goal.goalMartId).toBe('b');
  const only = (await readSnapshot(store, 'u1', ['a']))!;
  expect(only.goal.classId).toBe('c1');
});
