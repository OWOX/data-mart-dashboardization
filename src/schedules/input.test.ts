import { MAX_RANGES, WARM_INPUT_SCHEMA, parseWarmInput, rangesFor } from './input';
import { DEFAULT_SETTINGS } from '../types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ok = { ranges: [{ range: { kind: 'preset', preset: 'qtd' }, compare: { kind: 'preset', preset: 'previous_period' }, weekStart: 'monday' }] };

test('a valid input parses as is', () => {
  expect(parseWarmInput(ok)).toEqual(ok);
});

test.each([
  ['no ranges', { ...ok, ranges: [] }],
  ['too many ranges', { ...ok, ranges: Array(MAX_RANGES + 1).fill(ok.ranges[0]) }],
  ['a custom range', { ...ok, ranges: [{ ...ok.ranges[0], range: { kind: 'custom', window: { from: '2026-01-01', to: '2026-01-31' } } }] }],
  ['an unknown preset', { ...ok, ranges: [{ ...ok.ranges[0], range: { kind: 'preset', preset: 'forever' } }] }],
  ['a bad week start', { ...ok, ranges: [{ ...ok.ranges[0], weekStart: 'friday' }] }],
  ['not an object', 'x'],
])('%s is refused', (_n, v) => {
  expect(parseWarmInput(v)).toBeNull();
});

test('no presets means the default range; comparison follows the project default', () => {
  expect(rangesFor([], { ...DEFAULT_SETTINGS, defaultPreset: 'mtd', comparisonDefault: false, weekStart: 'sunday' }))
    .toEqual([{ range: { kind: 'preset', preset: 'mtd' }, compare: { kind: 'off' }, weekStart: 'sunday' }]);
  expect(rangesFor(['ytd', 'last_month'], DEFAULT_SETTINGS).map((r) => [r.range.preset, r.compare])).toEqual([
    ['ytd', { kind: 'preset', preset: 'previous_period' }], ['last_month', { kind: 'preset', preset: 'previous_period' }],
  ]);
});

test('plugin.json declares the same input schema', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', 'plugin.json'), 'utf8'));
  expect(manifest.backend.actions['warm-cache'].input).toEqual(WARM_INPUT_SCHEMA);
});
