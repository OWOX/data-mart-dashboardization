import type { Model } from '../types';
import { normalizeCurrency } from '../lib/format';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const AGG_FNS = new Set(['SUM', 'COUNT', 'COUNT_DISTINCT', 'AVG', 'MIN', 'MAX']);
const validForecast = (f: unknown): boolean => f === null
  || (isObj(f) && isStr(f.martId) && isStr(f.dateField) && isObj(f.measure) && isStr(f.measure.field) && (f.measure.fn === null || (isStr(f.measure.fn) && AGG_FNS.has(f.measure.fn))));

function shaped(m: Record<string, unknown>): boolean {
  if (!isStr(m.inputHash) || !isStr(m.builtAt) || !isStr(m.builtBy)) return false;
  const goal = m.goal;
  if (!isObj(goal) || !isStr(goal.classId) || !isStr(goal.goalMartId)) return false;
  if (!Array.isArray(m.classes) || !Array.isArray(m.edges) || !Array.isArray(m.metrics)) return false;
  return m.classes.every((c) => isObj(c) && isStr(c.id) && isStr(c.martId) && isStr(c.title) && Array.isArray(c.metricIds)
      && typeof c.depth === 'number' && (c.keyMetricId === null || isStr(c.keyMetricId))
      && Array.isArray(c.contexts) && c.contexts.every((x) => isObj(x) && isStr(x.id) && isStr(x.name)))
    && m.metrics.every((x) => isObj(x) && isStr(x.id) && isStr(x.martId) && isObj(x.measure)
      && (x.kind === 'flow' || x.kind === 'level') && (x.dateField === null || isStr(x.dateField))
      && (x.plan === null || (isObj(x.plan) && isStr(x.plan.martId) && isObj(x.plan.measure) && isStr(x.plan.dateField) && isStr(x.plan.shape))))
    && m.edges.every((e) => isObj(e) && isStr(e.from) && isStr(e.to));
}

const FORMATS = new Set(['number', 'percent', 'currency']);
// a missing or unknown format is a plain number
const fixFormat = (x: Record<string, unknown>): Record<string, unknown> => {
  const format = isStr(x.format) && FORMATS.has(x.format) ? x.format : 'number';
  return { ...x, format, currency: format === 'currency' ? normalizeCurrency(x.currency) : null };
};

// a metric-level calculated field is a ratio: summing its daily values means nothing, so it is never a level
const fixKind = (x: Record<string, unknown>): Record<string, unknown> => (isObj(x.measure) && x.measure.fn === null && x.kind !== 'flow' ? { ...x, kind: 'flow' } : x);

/** The saved key metric moves to the front once, so the order alone says which metric is the main one. */
function keyFirst(classes: Record<string, unknown>[], metrics: Record<string, unknown>[]): Record<string, unknown>[] {
  const shown = new Set(metrics.filter((x) => x.shown !== false).map((x) => x.id));
  return classes.map((c) => {
    const ids = c.metricIds as string[];
    const key = c.keyMetricId;
    // already the first shown one: the order says so, leave it
    if (!isStr(key) || !shown.has(key) || ids.find((id) => shown.has(id)) === key) return c;
    return { ...c, metricIds: [key, ...ids.filter((id) => id !== key)] };
  });
}

/** A v1 or v2 doc becomes v3 (no core classes, no editor); a valid v3 doc passes; anything else is null. */
export function upgradeModel(raw: unknown): Model | null {
  if (!isObj(raw) || !shaped(raw)) return null;
  if (raw.version === 3) {
    const classes = raw.classes as Record<string, unknown>[];
    const metrics = raw.metrics as Record<string, unknown>[];
    const ok = (raw.editedAt === null || isStr(raw.editedAt))
      && (raw.editedBy === null || isStr(raw.editedBy))
      && classes.every((c) => typeof c.shown === 'boolean' && typeof c.core === 'boolean' && Number.isInteger(c.inbound) && (c.inbound as number) >= 0)
      && metrics.every((x) => typeof x.shown === 'boolean');
    // a malformed forecast source falls back to the extrapolated forecast; the rest of the model stays
    return ok ? ({ ...raw, classes: keyFirst(classes, metrics), metrics: metrics.map((x) => fixFormat(fixKind(validForecast(x.forecast) ? x : { ...x, forecast: null }))) } as unknown as Model) : null;
  }
  if (raw.version === 2) {
    const classes = raw.classes as Record<string, unknown>[];
    const metrics = raw.metrics as Record<string, unknown>[];
    const ok = (raw.editedAt === null || isStr(raw.editedAt))
      && classes.every((c) => typeof c.shown === 'boolean')
      && metrics.every((x) => typeof x.shown === 'boolean');
    return ok ? upgradeModel({ ...raw, version: 3, editedBy: null, classes: classes.map((c) => ({ ...c, core: false, inbound: 0 })) }) : null;
  }
  if (raw.version !== 1) return null;
  return upgradeModel({
    ...raw,
    version: 2,
    editedAt: null,
    classes: (raw.classes as Record<string, unknown>[]).map((c) => ({ ...c, shown: true })),
    metrics: (raw.metrics as Record<string, unknown>[]).map((x) => ({ ...x, shown: true, forecast: null })),
  });
}
