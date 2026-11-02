import type { BuildResult, ClassNode, MetricDef } from '../types';
import { extractLinks } from '../lib/links';
import type { MartLink } from '../lib/links';
import { hashString } from '../lib/hash';
import { describeError } from '../lib/errors';
import { runPool } from '../lib/pool';
import { DATE_TYPES, fetchBlendable, fetchInputs, fetchMartDetail, flattenFields } from '../owox/sources';
import type { Blendable, Inputs, MartDetail, OwoxLike } from '../owox/sources';
import { buildEdges, chooseMain, classDepths, hasPrimaryKey } from './graph';
import type { MartNode } from './graph';
import { interpret } from './interpret';
import type { Generate } from './interpret';
import { uniqueCountMetric, validate } from './validate';

export interface HashMart { id: string; detail: MartDetail; blendable: Blendable }

const byText = (a: string, b: string) => a.localeCompare(b);

/** Covers descriptions and the schema/source signatures of the class marts; modifiedAt is left out, it churns on every actualisation. */
export function inputHash(inputs: Pick<Inputs, 'projectDescription' | 'contexts'>, marts: HashMart[]): string {
  return hashString(JSON.stringify([
    // Bumped when a model needs rebuilding to carry new fields (v2: MetricDef.calculated).
    'model-v2',
    inputs.projectDescription,
    [...inputs.contexts].sort((a, b) => byText(a.id, b.id)).map((c) => [c.id, c.description]),
    [...marts].sort((a, b) => byText(a.id, b.id)).map((m) => [
      m.id,
      flattenFields(m.detail.fields)
        .map((x) => [x.path, x.field.type, x.field.isPrimaryKey, x.field.calculated?.formula ?? null, x.field.description ?? null] as const)
        .sort((a, b) => byText(a[0], b[0])),
      m.blendable.availableSources
        .map((s) => [s.aliasPath, s.dataMartId] as const)
        .sort((a, b) => byText(a[0], b[0]) || byText(a[1], b[1])),
    ]),
  ]));
}

/** The hash as it would be computed now; rejects when any class mart can't be fetched. */
export async function currentInputHash(owox: OwoxLike, inputs: Inputs, martIds: string[]): Promise<string> {
  const got = await runPool(martIds.map((id) => async (): Promise<HashMart> => ({
    id, detail: await fetchMartDetail(owox, id), blendable: await fetchBlendable(owox, id),
  })), POOL);
  const marts = got.map((r) => { if (r.status === 'rejected') throw r.reason; return r.value; });
  return inputHash(inputs, marts);
}

const POOL = 6;
const fail = (code: 'AI_NOT_CONFIGURED' | 'AI_INVALID' | 'GOAL_NOT_CONNECTED', detail: string, mismatches: string[] = []): BuildResult =>
  ({ ok: false, blocked: { code, detail, mismatches } });

export async function buildModel(args: { owox: OwoxLike; generate: Generate | null; userId: string; now: Date }): Promise<BuildResult> {
  const { owox, generate, userId, now } = args;
  if (!generate) return fail('AI_NOT_CONFIGURED', 'Ask a project admin to map an AI model to this plugin.');

  const inputs = await fetchInputs(owox);
  const visible = new Set(inputs.marts.map((m) => m.id));

  const links: MartLink[] = extractLinks(inputs.projectDescription, 'project', 0);
  for (const c of inputs.contexts) links.push(...extractLinks(c.description, c.id, links.length));

  const details = new Map<string, MartDetail>();
  const linked = [...new Set(links.flatMap((l) => (l.martId && visible.has(l.martId) ? [l.martId] : [])))];
  const got = await runPool(linked.map((id) => () => fetchMartDetail(owox, id)), POOL);
  const failures = new Map<string, unknown>();
  got.forEach((r, i) => { if (r.status === 'fulfilled') details.set(r.value.id, r.value); else failures.set(linked[i]!, r.reason); });
  const titleOf = (id: string) => inputs.marts.find((m) => m.id === id)?.title ?? id;
  const buildFailed = (id: string, e: unknown) => new Error(`BUILD_FAILED: couldn't load ${titleOf(id)}: ${describeError(e)}`);
  const dateFields: Record<string, string[]> = {};
  for (const [id, d] of details) dateFields[id] = flattenFields(d.fields).filter((x) => DATE_TYPES.has(x.field.type.toUpperCase())).map((x) => x.path);

  let ai;
  try {
    ai = await interpret(generate, { projectDescription: inputs.projectDescription, contexts: inputs.contexts, links, dateFields });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    return fail('AI_INVALID', "The AI's reading of the descriptions doesn't match the Data Mart schemas.", [e instanceof Error ? e.message : String(e)]);
  }

  const goalMetric = ai.metrics.find((m) => m.ref === ai.goal.metricRef);
  const gl = goalMetric && goalMetric.factLink !== null ? links[goalMetric.factLink] : undefined;
  if (ai.goal.status === 'ok' && gl?.martId && visible.has(gl.martId) && failures.has(gl.martId)) throw buildFailed(gl.martId, failures.get(gl.martId));

  const v = validate({ ai, links, details, visible });
  if (!v.ok) return v;

  const loaded = await runPool(inputs.marts.map((m) => async (): Promise<MartNode> => {
    const detail = details.get(m.id) ?? await fetchMartDetail(owox, m.id);
    const blendable: Blendable = await fetchBlendable(owox, m.id);
    return { id: m.id, title: m.title, contexts: m.contexts, detail, blendable };
  }), POOL);
  const nodes = loaded.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  loaded.forEach((r, i) => { if (r.status === 'rejected') failures.set(inputs.marts[i]!.id, r.reason); });

  const goalLink = links.find((l) => l.martId === v.goal.martId && l.field === v.goal.field);
  const main = chooseMain({ goalMartId: v.goal.martId, goalField: v.goal.field, nodes, visible });
  if (!main) return fail('GOAL_NOT_CONNECTED', `None of the Data Marts you can see reference ${goalLink?.text ?? v.goal.field} through a calculated field.`);

  if (!nodes.some((n) => n.id === main.id)) throw buildFailed(main.id, failures.get(main.id));

  const edges = buildEdges(nodes, visible);
  const withPk = new Set(nodes.filter((n) => hasPrimaryKey(n.detail)).map((n) => n.id));
  const depths = classDepths(main.id, edges, withPk);

  const rank = (m: MetricDef) => (m.role === 'critical' ? (m.source === 'project' ? 0 : 1) : m.role === 'leading' ? 2 : m.role === 'lagging' ? 3 : 4);
  const metrics: MetricDef[] = [];
  const classes: ClassNode[] = [];
  for (const n of nodes) {
    const depth = depths.get(n.id);
    if (depth === undefined) continue;
    const own = v.metrics.filter((m) => m.martId === n.id);
    const uc = uniqueCountMetric(n.detail, n.blendable);
    if (uc && !own.some((m) => m.id === uc.id)) own.push(uc);
    const ranked = own.map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).map((x) => x.m);
    const seen = new Set<string>();
    const sorted = ranked.filter((m) => !seen.has(m.id) && !!seen.add(m.id));
    metrics.push(...sorted);
    classes.push({ id: n.id, martId: n.id, title: n.title, contexts: n.contexts, depth, keyMetricId: sorted[0]?.id ?? null, metricIds: sorted.map((m) => m.id) });
  }
  classes.sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  metrics.sort((a, b) => a.id.localeCompare(b.id));

  return {
    ok: true,
    model: {
      version: 1,
      inputHash: inputHash(inputs, nodes.filter((n) => depths.has(n.id))),
      builtAt: now.toISOString(),
      builtBy: userId,
      goal: { classId: main.id, metricId: main.viaFallback ? null : v.goal.metricId, goalMartId: v.goal.martId, viaFallback: main.viaFallback },
      classes,
      edges: edges.filter((e) => depths.has(e.from) && depths.has(e.to)).map((e) => ({ from: e.from, to: e.to, fields: e.fields })),
      metrics,
    },
  };
}
