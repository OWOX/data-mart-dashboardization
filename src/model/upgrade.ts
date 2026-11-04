import type { Model } from '../types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

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

/** A v1 doc becomes v2 (everything shown, no forecast source, never edited); a valid v2 doc passes; anything else is null. */
export function upgradeModel(raw: unknown): Model | null {
  if (!isObj(raw) || !shaped(raw)) return null;
  if (raw.version === 2) {
    const classes = raw.classes as Record<string, unknown>[];
    const metrics = raw.metrics as Record<string, unknown>[];
    const ok = (raw.editedAt === null || isStr(raw.editedAt))
      && classes.every((c) => typeof c.shown === 'boolean')
      && metrics.every((x) => typeof x.shown === 'boolean' && (x.forecast === null || isObj(x.forecast)));
    return ok ? (raw as unknown as Model) : null;
  }
  if (raw.version !== 1) return null;
  return {
    ...raw,
    version: 2,
    editedAt: null,
    classes: (raw.classes as Record<string, unknown>[]).map((c) => ({ ...c, shown: true })),
    metrics: (raw.metrics as Record<string, unknown>[]).map((x) => ({ ...x, shown: true, forecast: null })),
  } as unknown as Model;
}
