import { PRESET_LABELS, type ComparePreset, type Preset, type Settings, type WeekStart } from '../types';

export const WARM_ACTION = 'warm-cache';
export const MAX_RANGES = 5;
export const MAX_MARTS = 200;

export interface WarmRange {
  range: { kind: 'preset'; preset: Preset };
  compare: { kind: 'off' } | { kind: 'preset'; preset: ComparePreset };
  weekStart: WeekStart;
}
/** What a schedule passes to the warm-cache action. `memberId` marks whose schedule it is; OWOX keeps no creator. */
export interface WarmInput { memberId: string; martIds: string[]; ranges: WarmRange[] }

const PRESETS = Object.keys(PRESET_LABELS) as Preset[];
const COMPARES: ComparePreset[] = ['previous_period', 'preceding_days', 'year_before'];

/** The action's input schema; plugin.json carries a copy and a test keeps them equal. */
export const WARM_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['memberId', 'martIds', 'ranges'],
  properties: {
    memberId: { type: 'string', minLength: 1, maxLength: 200 },
    martIds: { type: 'array', maxItems: MAX_MARTS, items: { type: 'string', minLength: 1, maxLength: 200 } },
    ranges: {
      type: 'array', minItems: 1, maxItems: MAX_RANGES,
      items: {
        type: 'object', additionalProperties: false, required: ['range', 'compare', 'weekStart'],
        properties: {
          range: { type: 'object', additionalProperties: false, required: ['kind', 'preset'], properties: { kind: { const: 'preset' }, preset: { enum: PRESETS } } },
          compare: {
            oneOf: [
              { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { const: 'off' } } },
              { type: 'object', additionalProperties: false, required: ['kind', 'preset'], properties: { kind: { const: 'preset' }, preset: { enum: COMPARES } } },
            ],
          },
          weekStart: { enum: ['monday', 'sunday'] },
        },
      },
    },
  },
} as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;

function rangeOf(v: unknown): WarmRange | null {
  if (!isObj(v) || !isObj(v.range) || !isObj(v.compare)) return null;
  const { range, compare, weekStart } = v;
  if (range.kind !== 'preset' || !PRESETS.includes(range.preset as Preset)) return null;
  if (weekStart !== 'monday' && weekStart !== 'sunday') return null;
  const c = compare.kind === 'off' ? { kind: 'off' as const }
    : compare.kind === 'preset' && COMPARES.includes(compare.preset as ComparePreset) ? { kind: 'preset' as const, preset: compare.preset as ComparePreset } : null;
  return c ? { range: { kind: 'preset', preset: range.preset as Preset }, compare: c, weekStart } : null;
}

/** The input checked again in code: a schedule's parameters may come from another version. */
export function parseWarmInput(v: unknown): WarmInput | null {
  if (!isObj(v) || !isId(v.memberId) || !Array.isArray(v.martIds) || !Array.isArray(v.ranges)) return null;
  if (v.martIds.length > MAX_MARTS || !v.martIds.every(isId)) return null;
  if (v.ranges.length < 1 || v.ranges.length > MAX_RANGES) return null;
  const ranges = v.ranges.map(rangeOf);
  if (ranges.some((r) => r === null)) return null;
  return { memberId: v.memberId, martIds: [...v.martIds] as string[], ranges: ranges as WarmRange[] };
}

/** The ranges a schedule warms; none chosen means the member's default range. Comparison and week start come from the settings at save time. */
export function rangesFor(presets: Preset[], s: Settings): WarmRange[] {
  const compare: WarmRange['compare'] = s.comparisonDefault ? { kind: 'preset', preset: 'previous_period' } : { kind: 'off' };
  return (presets.length ? presets : [s.defaultPreset]).slice(0, MAX_RANGES).map((preset) => ({ range: { kind: 'preset', preset }, compare, weekStart: s.weekStart }));
}
