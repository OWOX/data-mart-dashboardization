import type { CacheDoc, CardCache, MetricResult, Model, Preset, RangeSpec, SeriesPack } from '../types';
import { runPool } from '../lib/pool';
import type { OwoxLike } from '../owox/sources';
import { computeMetric } from './compute';

export const cacheKey = (preset: Preset, comparisonOn: boolean): string => `${preset}:${comparisonOn ? 'cmp' : 'nocmp'}`;

export async function refreshCanvas(args: {
  owox: OwoxLike; model: Model; spec: RangeSpec; comparisonOn: boolean; thresholdPct: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<CacheDoc> {
  const { owox, model, spec, comparisonOn, thresholdPct, onProgress } = args;
  const byId = new Map(model.metrics.map((m) => [m.id, m]));
  const keyIds = new Set(model.classes.map((c) => c.keyMetricId).filter((id): id is string => !!id));

  const ids = new Set<string>();
  for (const c of model.classes) for (const id of c.metricIds) if (byId.has(id)) ids.add(id);
  const results = new Map<string, MetricResult>();
  const sparks = new Map<string, SeriesPack | null>();
  let done = 0;

  await runPool([...ids].map((id) => async () => {
    const out = await computeMetric({ owox, metric: byId.get(id)!, spec, comparisonOn, thresholdPct, withSpark: keyIds.has(id) });
    results.set(id, out.result);
    sparks.set(id, out.spark);
    onProgress?.(++done, ids.size);
  }), 6);

  const cards: Record<string, CardCache> = {};
  for (const c of model.classes) {
    const metrics: Record<string, MetricResult> = {};
    for (const id of c.metricIds) { const r = results.get(id); if (r) metrics[id] = r; }
    cards[c.id] = { metrics, spark: (c.keyMetricId && sparks.get(c.keyMetricId)) || null };
  }
  return { modelHash: model.inputHash, anchor: spec.anchor, refreshedAt: new Date().toISOString(), preset: spec.preset, comparison: comparisonOn, cards };
}
