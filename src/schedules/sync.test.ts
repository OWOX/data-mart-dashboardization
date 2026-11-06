import type { PluginSchedule, PluginSchedules } from '@owox/plugin-sdk';
import { ownSchedules, syncSchedules } from './sync';
import { martIdsOf } from './snapshot';
import { memoryCollections } from '../store/collections';
import { model as fixtureModel } from '../test/fixtures';

const sched = (id: string, parameters: unknown): PluginSchedule => ({
  id, name: null, action: 'warm-cache', parameters, cron: '0 9 * * *', timeZone: 'UTC', enabled: true,
  disabledReason: null, nextRunAt: null, lastRun: null, createdAt: '', modifiedAt: '',
});
const range = { range: { kind: 'preset', preset: 'qtd' }, compare: { kind: 'off' }, weekStart: 'monday' };

test('ownSchedules keeps only valid warm-cache schedules of the member', () => {
  const all = [
    sched('a', { memberId: 'u1', martIds: [], ranges: [range] }),
    sched('b', { memberId: 'u2', martIds: [], ranges: [range] }),
    sched('c', { something: 'else' }),
    { ...sched('d', { memberId: 'u1', martIds: [], ranges: [range] }), action: 'other' },
  ];
  expect(ownSchedules(all, 'u1').map((s) => s.id)).toEqual(['a']);
});

test('syncSchedules rewrites the snapshot and the mart ids of own schedules only when they changed', async () => {
  const store = memoryCollections();
  const ids = martIdsOf(fixtureModel);
  const list = [sched('a', { memberId: 'u1', martIds: ['old'], ranges: [range] }), sched('b', { memberId: 'u1', martIds: ids, ranges: [range] }), sched('c', { memberId: 'u2', martIds: ['old'], ranges: [range] })];
  const update = vi.fn(async (id: string) => list.find((s) => s.id === id)!);
  const schedules = { list: async () => list, update } as unknown as PluginSchedules;
  await syncSchedules({ schedules, store, model: fixtureModel, memberId: 'u1' });
  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith('a', { parameters: { memberId: 'u1', martIds: ids, ranges: [range] } });
  expect(await store.collections('schedule-models').get(`u1:${ids[0]}`)).not.toBeNull();
});

test('syncSchedules writes nothing for a member without schedules', async () => {
  const store = memoryCollections();
  const schedules = { list: async () => [], update: vi.fn() } as unknown as PluginSchedules;
  await syncSchedules({ schedules, store, model: fixtureModel, memberId: 'u1' });
  expect(await store.collections('schedule-models').get(`u1:${martIdsOf(fixtureModel)[0]}`)).toBeNull();
});
