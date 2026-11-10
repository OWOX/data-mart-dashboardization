import type { ClassNode, Edge, Measure, MetricDef, Model, PlanDef } from '../types';
import { classDepths } from './graph';

export type MetricField = 'measure' | 'dateField' | 'plan' | 'kind' | 'format';

export type Change =
  | { kind: 'class_added' | 'class_removed'; classId: string; title: string }
  | { kind: 'metric_added' | 'metric_removed'; classId: string; metricId: string; alias: string }
  | { kind: 'metric_changed'; classId: string; metricId: string; field: MetricField; before: string; after: string };

const measureKey = (m: MetricDef): string => `${m.martId}\u0000${m.measure.field}\u0000${m.measure.fn ?? 'calc'}`;
const measureText = (m: MetricDef): string => `${m.measure.field} (${m.measure.fn ?? 'calculated'})`;
const planText = (m: MetricDef): string => (m.plan ? `${m.plan.martId}: ${m.plan.measure.field} (${m.plan.measure.fn ?? 'calculated'}) by ${m.plan.dateField || 'no date'}, ${m.plan.shape}` : 'none');
const dateText = (m: MetricDef): string => m.dateField ?? 'no date';

const formatText = (m: MetricDef): string => (m.format === 'currency' && m.currency ? `currency (${m.currency})` : m.format);

const FIELDS: { field: MetricField; text: (m: MetricDef) => string }[] = [
  { field: 'measure', text: measureText },
  { field: 'dateField', text: dateText },
  { field: 'plan', text: planText },
  { field: 'kind', text: (m) => m.kind },
  { field: 'format', text: formatText },
];
// field by field, not by JSON: a stored model may come back with its keys in another order or without a null fn
const sameMeasure = (a: Measure, b: Measure): boolean => a.field === b.field && (a.fn ?? null) === (b.fn ?? null);
const samePlan = (a: PlanDef | null, b: PlanDef | null): boolean =>
  a === null || b === null ? a === b : a.martId === b.martId && a.dateField === b.dateField && a.shape === b.shape && sameMeasure(a.measure, b.measure);
// text can hide a difference (a plan's Data Mart), so what counts as changed is the structure
const same = (f: MetricField, a: MetricDef, b: MetricDef): boolean => {
  switch (f) {
    case 'measure': return sameMeasure(a.measure, b.measure);
    case 'plan': return samePlan(a.plan ?? null, b.plan ?? null);
    case 'format': return (a.format === 'currency' && b.format === 'currency' && b.currency === null) || formatText(a) === formatText(b);
    case 'dateField': return (a.dateField ?? null) === (b.dateField ?? null);
    case 'kind': return a.kind === b.kind;
  }
};

const classOf = (m: Model, metricId: string, martId: string): string => m.classes.find((c) => c.metricIds.includes(metricId))?.id ?? martId;

/**
 * Pairs each candidate metric with the current one it stands for: the same id, or else the same Data Mart, field and aggregation.
 * An id is an identity, not a description: a member may have edited the fact field since, so ids are never compared against fields.
 */
function pairMetrics(current: Model, candidate: Model): Map<string, MetricDef> {
  const byId = new Map(current.metrics.map((m) => [m.id, m]));
  const taken = new Set<string>();
  const pairs = new Map<string, MetricDef>(); // candidate id -> current metric
  for (const c of candidate.metrics) {
    const hit = byId.get(c.id);
    if (hit) { pairs.set(c.id, hit); taken.add(hit.id); }
  }
  for (const c of candidate.metrics) {
    if (pairs.has(c.id)) continue;
    const hit = current.metrics.find((m) => !taken.has(m.id) && measureKey(m) === measureKey(c));
    if (hit) { pairs.set(c.id, hit); taken.add(hit.id); }
  }
  return pairs;
}

/** What a rebuild would change. The metrics of an added or removed class travel with the class row. */
export function diffModels(current: Model, candidate: Model): Change[] {
  const changes: Change[] = [];
  const have = new Set(current.classes.map((c) => c.id));
  const want = new Set(candidate.classes.map((c) => c.id));
  for (const c of candidate.classes) if (!have.has(c.id)) changes.push({ kind: 'class_added', classId: c.id, title: c.title });
  // the goal class goes only when the candidate names another goal class that will exist; otherwise the row would be dropped on apply
  const goalMoves = candidate.goal.classId !== current.goal.classId && want.has(candidate.goal.classId);
  for (const c of current.classes) if (!want.has(c.id) && (c.id !== current.goal.classId || goalMoves)) changes.push({ kind: 'class_removed', classId: c.id, title: c.title });

  const pairs = pairMetrics(current, candidate);
  const matched = new Set([...pairs.values()].map((m) => m.id));
  for (const c of candidate.metrics) {
    const classId = classOf(candidate, c.id, c.martId);
    if (!have.has(classId)) continue;
    const old = pairs.get(c.id);
    if (!old) { changes.push({ kind: 'metric_added', classId, metricId: c.id, alias: c.alias }); continue; }
    for (const f of FIELDS) {
      if (!same(f.field, old, c)) changes.push({ kind: 'metric_changed', classId: classOf(current, old.id, old.martId), metricId: old.id, field: f.field, before: f.text(old), after: f.text(c) });
    }
  }
  for (const m of current.metrics) {
    const classId = classOf(current, m.id, m.martId);
    if (!matched.has(m.id) && want.has(classId)) changes.push({ kind: 'metric_removed', classId, metricId: m.id, alias: m.alias });
  }
  return changes;
}

const firstShown = (metricIds: string[], metrics: MetricDef[]): string | null => metricIds.find((id) => metrics.find((m) => m.id === id)?.shown !== false) ?? null;

/** The picked changes laid over the current model. `shown` flags and forecast sources are never touched; `now` stamps editedAt when a picked change applies. */
export function applyChanges(current: Model, candidate: Model, picked: Change[], now: string): Model {
  // nothing picked still redraws the lines; they don't feed the numbers, so editedAt stays and the cache with it
  if (picked.length === 0) return relink(current, candidate);
  const pairs = pairMetrics(current, candidate);
  // the current metric a candidate one stands for, under its current id
  const idFor = (candidateId: string): string => pairs.get(candidateId)?.id ?? candidateId;
  const candById = new Map(candidate.metrics.map((m) => [m.id, m]));
  const candClass = new Map(candidate.classes.map((c) => [c.id, c]));

  let classes: ClassNode[] = current.classes.map((c) => ({ ...c, metricIds: [...c.metricIds] }));
  let metrics: MetricDef[] = current.metrics.map((m) => ({ ...m }));
  let goalRemoved = false;

  // a goal class goes only if the candidate names another one that will exist
  const added = new Set(picked.flatMap((p) => (p.kind === 'class_added' ? [p.classId] : [])));
  const goalSurvives = candidate.goal.classId !== current.goal.classId && (classes.some((c) => c.id === candidate.goal.classId) || added.has(candidate.goal.classId));

  for (const p of picked) {
    if (p.kind === 'class_removed') {
      if (p.classId === current.goal.classId && !goalSurvives) continue;
      const gone = classes.find((c) => c.id === p.classId);
      if (!gone) continue;
      const ids = new Set(gone.metricIds);
      classes = classes.filter((c) => c.id !== p.classId);
      if (p.classId === current.goal.classId) goalRemoved = true;
      metrics = metrics.filter((m) => !ids.has(m.id));
    } else if (p.kind === 'class_added') {
      const c = candClass.get(p.classId);
      if (!c || classes.some((x) => x.id === c.id)) continue;
      const own = c.metricIds.flatMap((id) => { const m = candById.get(id); return m && !pairs.has(id) && !metrics.some((x) => x.id === id) ? [{ ...m, shown: true, forecast: null }] : []; });
      metrics = [...metrics, ...own];
      classes = [...classes, { ...c, shown: true, metricIds: own.map((m) => m.id), keyMetricId: null }];
    }
  }

  for (const p of picked) {
    if (p.kind === 'metric_added') {
      const m = candById.get(p.metricId);
      const cls = classes.find((c) => c.id === p.classId);
      if (!m || !cls || metrics.some((x) => x.id === m.id)) continue;
      metrics = [...metrics, { ...m, shown: true, forecast: null }];
      classes = classes.map((c) => (c.id === cls.id ? { ...c, metricIds: [...c.metricIds, m.id] } : c));
    } else if (p.kind === 'metric_removed') {
      metrics = metrics.filter((m) => m.id !== p.metricId);
      classes = classes.map((c) => (c.metricIds.includes(p.metricId) ? { ...c, metricIds: c.metricIds.filter((id) => id !== p.metricId) } : c));
    } else if (p.kind === 'metric_changed') {
      const cand = [...pairs.entries()].find(([, cur]) => cur.id === p.metricId)?.[0];
      const next = cand ? candById.get(cand) : undefined;
      if (!next) continue;
      metrics = metrics.map((m) => {
        if (m.id !== p.metricId) return m;
        switch (p.field) {
          case 'kind': return { ...m, kind: next.kind };
          case 'format': return { ...m, format: next.format, currency: next.currency };
          case 'dateField': return { ...m, dateField: next.dateField };
          case 'plan': return { ...m, plan: next.plan };
          case 'measure': return { ...m, measure: next.measure, calculated: next.calculated, description: next.description };
        }
      });
    }
  }

  // the key metric is the first shown one in the member's order; added metrics sit at the end
  classes = classes.map((c) => ({ ...c, keyMetricId: firstShown(c.metricIds, metrics) }));

  const ids = new Set(classes.map((c) => c.id));
  let goal = current.goal;
  // the goal follows the candidate only when the current goal class is gone
  if (goalRemoved && ids.has(candidate.goal.classId)) goal = { ...candidate.goal, metricId: candidate.goal.metricId ? idFor(candidate.goal.metricId) : null };
  if (goal.metricId && !metrics.some((m) => m.id === goal.metricId)) goal = { ...goal, metricId: null };

  return relink({ ...current, classes, metrics, goal, inputHash: candidate.inputHash, editedAt: now }, candidate);
}

/**
 * Edges come from the Data Marts' refs and are never edited, so between two classes the candidate knows they follow it,
 * and the depths that order the cards are walked again from them. A class only the current model keeps (a kept goal, a declined removal) keeps its own.
 * A candidate class the model lacks (a declined add) stays in the edges as a bridge when it links two classes, so the canvas draws a dashed line through it.
 */
export function relink(model: Model, candidate: Model): Model {
  const ids = new Set(model.classes.map((c) => c.id));
  const known = new Set(candidate.classes.map((c) => c.id));
  const within = (e: Edge) => ids.has(e.from) && ids.has(e.to);
  const both = (e: Edge) => known.has(e.from) && known.has(e.to);
  // bridges: candidate classes outside the model that a class reaches and that reach a class, walking only through bridges
  const reach = (from: 'from' | 'to', to: 'from' | 'to'): Set<string> => {
    const seen = new Set<string>();
    const queue = [...ids];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of candidate.edges) {
        const n = e[to];
        if (e[from] !== cur || ids.has(n) || !known.has(n) || seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    return seen;
  };
  const back = reach('to', 'from');
  const bridges = new Set([...reach('from', 'to')].filter((id) => back.has(id)));
  const on = (id: string) => ids.has(id) || bridges.has(id);
  const edges = [
    ...model.edges.filter((e) => within(e) && !both(e)),
    ...candidate.edges.filter((e) => both(e) && on(e.from) && on(e.to)),
  ];
  const depths = classDepths(model.goal.classId, edges, new Set([...ids, ...bridges]));
  return { ...model, edges, classes: model.classes.map((c) => ({ ...c, depth: depths.get(c.id) ?? c.depth })) };
}

const edgeKey = (e: Edge): string => `${e.from}\u0000${e.to}\u0000${[...(e.fields ?? [])].sort().join('\u0001')}`;
const depthKey = (c: ClassNode): string => `${c.id}\u0000${c.depth}`;
const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/** Whether the lines or the card order differ; the order the edges are stored in is no difference. */
export const linksDiffer = (a: Model, b: Model): boolean => !sameSet(a.edges.map(edgeKey), b.edges.map(edgeKey)) || !sameSet(a.classes.map(depthKey), b.classes.map(depthKey));
