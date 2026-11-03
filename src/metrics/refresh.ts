import type { CacheDoc, CardCache, MetricResult, Model, RangeChoice, RangeSpec, CompareChoice, SeriesPack, WeekStart } from '../types';
import { runPool } from '../lib/pool';
import type { OwoxLike } from '../owox/sources';
import { rangeKey, compareKey } from '../lib/dates';
import { computeMetric } from './compute';

const sig4 = (n: number): number => Number(n.toPrecision(4));
const round = (s: SeriesPack): SeriesPack => ({ ...s, values: s.values.map((v) => (v === null ? v : sig4(v))), forecast: s.forecast.map(sig4) });

const MAX_DOC_CHARS = 900_000;

/** Sparks are the bulk of a doc; drop them all when it would not fit in the collection. */
export function trimToSize(doc: CacheDoc, limit = MAX_DOC_CHARS): CacheDoc {
  if (JSON.stringify(doc).length <= limit) return doc;
  return { ...doc, cards: Object.fromEntries(Object.entries(doc.cards).map(([id, c]) => [id, { ...c, spark: null }])) };
}

/** Week presets resolve to other days under a Sunday start, so only they carry it (Monday keeps the old keys). */
export const cacheKey = (range: RangeChoice, compare: CompareChoice, weekStart: WeekStart = 'monday'): string => {
  const weekly = range.kind === 'preset' && (range.preset === 'this_week' || range.preset === 'last_week') && weekStart === 'sunday';
  return `${rangeKey(range)}:${compareKey(compare)}${weekly ? ':sun' : ''}`;
};

/** Custom choices are not persisted: they would pile up per member. */
export const persistable = (range: RangeChoice, compare: CompareChoice): boolean =>
  range.kind !== 'custom' && compare.kind !== 'custom';

export async function refreshCanvas(args: {
  owox: OwoxLike; model: Model; spec: RangeSpec; key: string; thresholdPct: number;
  visibleIds?: ReadonlySet<string> | null; onProgress?: (done: number, total: number) => void;
}): Promise<CacheDoc> {
  const { owox, model, spec, key, thresholdPct, visibleIds, onProgress } = args;
  const classes = model.classes.filter((c) => !visibleIds || visibleIds.has(c.id));
  const byId = new Map(model.metrics.map((m) => [m.id, m]));
  const keyIds = new Set(classes.map((c) => c.keyMetricId).filter((id): id is string => !!id));

  const ids = new Set<string>();
  for (const c of classes) for (const id of c.metricIds) if (byId.has(id)) ids.add(id);
  const results = new Map<string, MetricResult>();
  const sparks = new Map<string, SeriesPack | null>();
  let done = 0;

  await runPool([...ids].map((id) => async () => {
    const out = await computeMetric({ owox, metric: byId.get(id)!, spec, thresholdPct, withSpark: keyIds.has(id) });
    results.set(id, out.result);
    sparks.set(id, out.spark);
    onProgress?.(++done, ids.size);
  }), 6);

  const cards: Record<string, CardCache> = {};
  for (const c of classes) {
    const metrics: Record<string, MetricResult> = {};
    for (const id of c.metricIds) { const r = results.get(id); if (r) metrics[id] = r; }
    const spark = (c.keyMetricId && sparks.get(c.keyMetricId)) || null;
    cards[c.id] = { metrics, spark: spark && round(spark) };
  }
  return trimToSize({
    modelHash: model.inputHash, builtAt: model.builtAt, thresholdPct, anchor: spec.anchor,
    refreshedAt: new Date().toISOString(), key, comparison: spec.comparison !== null, cards,
  });
}
