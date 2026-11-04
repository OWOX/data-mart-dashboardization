import type { CacheDoc, CardCache, MetricDef, MetricResult, Model, RangeChoice, RangeSpec, CompareChoice, SeriesPack, WeekStart } from '../types';
import { runPool } from '../lib/pool';
import type { OwoxLike } from '../owox/sources';
import { rangeKey, compareKey } from '../lib/dates';
import { shownModel } from '../model/shown';
import { BLOCKING, type Issue } from '../model/health';
import { describeError } from '../lib/errors';
import { computeMetric } from './compute';

const sig4 = (n: number): number => Number(n.toPrecision(4));
const round = (s: SeriesPack): SeriesPack => ({ ...s, values: s.values.map((v) => (v === null ? v : sig4(v))), forecast: s.forecast.map(sig4) });

const EMPTY: MetricResult = {
  fact: null, compareFact: null, comparison: null, diffPct: null, plan: null, forecast: null, forecastApprox: false,
  status: 'neutral', trend: 'flat', note: null, error: null,
};

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
  visibleIds?: ReadonlySet<string> | null; issues?: Issue[]; onProgress?: (done: number, total: number) => void;
  /** Called after each metric with the cards built so far. */
  onPartial?: (cards: Record<string, CardCache>) => void;
}): Promise<CacheDoc> {
  const { owox, model: full, spec, key, thresholdPct, visibleIds, issues = [], onProgress, onPartial } = args;
  const model = shownModel(full);
  const classes = model.classes.filter((c) => !visibleIds || visibleIds.has(c.id));
  const byId = new Map(model.metrics.map((m) => [m.id, m]));
  const keyIds = new Set(classes.map((c) => c.keyMetricId).filter((id): id is string => !!id));

  const ids = new Set<string>();
  for (const c of classes) for (const id of c.metricIds) if (byId.has(id)) ids.add(id);
  const results = new Map<string, MetricResult>();
  const sparks = new Map<string, SeriesPack | null>();
  let done = 0;

  // A partial card appears once any of its metrics is done; its spark once the key metric is.
  const build = (partial: boolean): Record<string, CardCache> => {
    const cards: Record<string, CardCache> = {};
    for (const c of classes) {
      const metrics: Record<string, MetricResult> = {};
      for (const id of c.metricIds) { const r = results.get(id); if (r) metrics[id] = r; }
      if (partial && Object.keys(metrics).length === 0) continue;
      const spark = (c.keyMetricId && sparks.get(c.keyMetricId)) || null;
      cards[c.id] = { metrics, spark: spark && round(spark) };
    }
    return cards;
  };

  // a class whose Data Mart is gone stops every metric of that Data Mart; a metric's own issues come with its id
  const goneMarts = new Set(issues.filter((i) => i.kind === 'mart_missing' && i.metricId === null).map((i) => i.martId));
  const mine = (id: string) => issues.filter((i) => i.metricId === id);

  onProgress?.(0, ids.size);
  await runPool([...ids].map((id) => async () => {
    const metric = byId.get(id)!;
    const own = mine(id);
    const block = own.find((i) => BLOCKING.has(i.kind)) ?? (goneMarts.has(metric.martId) ? { text: 'Data Mart not found or not accessible' } : undefined);
    const soft = own.filter((i) => !BLOCKING.has(i.kind));
    try {
      if (block) {
        results.set(id, { ...EMPTY, warning: block.text });
        sparks.set(id, null);
      } else {
        // a broken plan is dropped, a broken forecast source falls back to extrapolating the fact series
        const usable: MetricDef = {
          ...metric,
          plan: soft.some((i) => i.kind.startsWith('plan_')) ? null : metric.plan,
          forecast: soft.some((i) => i.kind.startsWith('forecast_')) ? null : metric.forecast,
        };
        const out = await computeMetric({ owox, metric: usable, spec, thresholdPct, withSpark: keyIds.has(id) });
        const warning = [...soft.map((i) => i.text), ...(out.result.error ? [out.result.error] : [])].join('; ') || null;
        results.set(id, warning ? { ...out.result, warning } : out.result);
        sparks.set(id, out.spark);
      }
    } catch (e) {
      // never leave the metric absent: the card would read as still loading
      results.set(id, { ...EMPTY, warning: describeError(e) });
      sparks.set(id, null);
    }
    onProgress?.(++done, ids.size);
    onPartial?.(build(true));
  }), 6);

  const cards = build(false);
  return trimToSize({
    modelHash: full.inputHash, builtAt: full.builtAt, editedAt: full.editedAt, thresholdPct, anchor: spec.anchor,
    refreshedAt: new Date().toISOString(), key, comparison: spec.comparison !== null, cards,
  });
}
