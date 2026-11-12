import type { Edge, Model } from '../types';
import { model } from '../test/fixtures';
import { applyCore, INDUSTRIES, inboundCounts, mergeCore, rankCore, singleKey } from './core';

const e = (from: string, to: string): Edge => ({ from, to });
const fixtureModel = (): Model => ({
  ...model,
  classes: [model.classes[0]!, { ...model.classes[0]!, id: 'b', martId: 'mb', title: 'B' }],
});

test('ranks by inbound references, then links to other candidates, then title', () => {
  const nodes = [
    { id: 'rev', title: 'Revenue', singleKey: true }, { id: 'cus', title: 'Customers', singleKey: true },
    { id: 'pro', title: 'Products', singleKey: true }, { id: 'vis', title: 'Visitors', singleKey: true },
    { id: 'cmp', title: 'Composite', singleKey: false }, { id: 'far', title: 'Far', singleKey: true },
  ];
  const edges = [e('rev', 'cus'), e('rev', 'pro'), e('x', 'cus'), e('y', 'cus'), e('x', 'pro'), e('rev', 'vis'), e('rev', 'cmp'), e('x', 'far'), e('cus', 'pro')];
  expect(rankCore({ goalId: 'rev', nodes, edges })).toEqual(['cus', 'pro', 'vis']);
});

test('a candidate that only references the goal counts as connected but needs inbound references', () => {
  const nodes = [{ id: 'rev', title: 'Revenue', singleKey: true }, { id: 'ses', title: 'Sessions', singleKey: true }];
  expect(rankCore({ goalId: 'rev', nodes, edges: [e('ses', 'rev')] })).toEqual([]);
  expect(rankCore({ goalId: 'rev', nodes, edges: [e('ses', 'rev'), e('z', 'ses')] })).toEqual(['ses']);
});

test('inboundCounts counts distinct referrers', () => {
  expect(inboundCounts([e('a', 'x'), e('b', 'x'), { ...e('a', 'x'), fields: ['f'] }, e('a', 'y')])).toEqual(new Map([['x', 2], ['y', 1]]));
});

test('mergeCore keeps existing, adds picks, caps at 7', () => {
  const c = (id: string) => ({ martId: id, why: id });
  expect(mergeCore(null, [c('a'), c('b')], ['x'], 3)).toEqual([c('a'), c('b')]);
  expect(mergeCore(null, [], ['x', 'y', 'z', 'w'], 3)).toEqual([{ martId: 'x', why: '' }, { martId: 'y', why: '' }, { martId: 'z', why: '' }]);
  expect(mergeCore([c('a'), c('b')], [c('b'), c('c')], [], 5)).toEqual([c('a'), c('b'), c('c')]);
  expect(mergeCore([c('a')], [], ['x'], 5)).toEqual([c('a')]); // a set list is never refilled from the ranking
  expect(mergeCore([1, 2, 3, 4, 5, 6, 7].map((i) => c(`k${i}`)), [c('new')], [], 5)).toHaveLength(7);
});

test('applyCore flags classes and records inbound counts', () => {
  const m = applyCore(fixtureModel(), [{ martId: fixtureModel().classes[1]!.martId, why: '' }], new Map([[fixtureModel().classes[1]!.id, 3]]));
  expect(m.classes[1]).toMatchObject({ core: true, inbound: 3 });
  expect(m.classes.filter((c) => c.core)).toHaveLength(1);
});

test('the industry table matches the spec', () => {
  expect(INDUSTRIES.map((i) => [i.id, i.count])).toEqual([['ecommerce', 5], ['saas', 5], ['marketplace', 6], ['media', 4], ['b2b', 4], ['apps', 4], ['finance', 5], ['other', 3]]);
  expect(INDUSTRIES[0]).toMatchObject({ label: 'E-commerce, retail', typical: ['Customers', 'Products', 'Sessions or Visitors', 'Campaigns', 'Stores or Channels'] });
});

test('singleKey needs exactly one primary key path', () => {
  const f = (name: string, pk: boolean) => ({ name, type: 'STRING', isPrimaryKey: pk });
  expect(singleKey({ id: 'x', title: 'X', fields: [f('a', true)] })).toBe(true);
  expect(singleKey({ id: 'x', title: 'X', fields: [f('a', true), f('b', true)] })).toBe(false);
  expect(singleKey({ id: 'x', title: 'X', fields: [f('a', false)] })).toBe(false);
});
