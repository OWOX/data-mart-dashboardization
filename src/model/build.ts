import type { BuildResult, ClassNode, CoreClass, Industry, MetricDef } from '../types';
import { extractLinks } from '../lib/links';
import type { MartLink } from '../lib/links';
import { hashString } from '../lib/hash';
import { describeError } from '../lib/errors';
import { runPool } from '../lib/pool';
import { DATE_TYPES, fetchBlendable, fetchInputs, fetchMartDetail, flattenFields } from '../owox/sources';
import type { Blendable, Inputs, MartDetail, OwoxLike } from '../owox/sources';
import { buildEdges, classDepths, hasPrimaryKey, primaryKeyPaths } from './graph';
import type { MartNode } from './graph';
import { interpret } from './interpret';
import type { AiMetric, Generate } from './interpret';
import { uniqueCountMetric, validate } from './validate';
import { INDUSTRIES, applyCore, inboundCounts, mergeCore, rankCore, singleKey } from './core';

export interface HashMart { id: string; detail: MartDetail; blendable: Blendable }

const byText = (a: string, b: string) => a.localeCompare(b);

/** Covers descriptions and the schema/source signatures of the class marts; modifiedAt is left out, it churns on every actualisation. */
export function inputHash(inputs: Pick<Inputs, 'projectDescription' | 'contexts'>, marts: HashMart[]): string {
  return hashString(JSON.stringify([
    // Bumped when a model needs rebuilding to carry new fields (v2: MetricDef.calculated; v3: Unique Count for every class with a primary key;
    // v4: only Data Marts with a date field are classes).
    'model-v4',
    inputs.projectDescription,
    [...inputs.contexts].sort((a, b) => byText(a.id, b.id)).map((c) => [c.id, c.description]),
    [...marts].sort((a, b) => byText(a.id, b.id)).map((m) => {
      const flat = flattenFields(m.detail.fields);
      // a hidden primary key still decides whether the mart is a class, and the flattened fields skip it; added only when
      // there is one, so a mart whose keys are all visible keeps the hash it had
      const shown = new Set(flat.filter((x) => x.field.isPrimaryKey).map((x) => x.path));
      const hiddenKeys = primaryKeyPaths(m.detail.fields).filter((p) => !shown.has(p)).sort(byText);
      return [
        m.id,
        flat
          .map((x) => [x.path, x.field.type, x.field.isPrimaryKey, x.field.calculated?.formula ?? null, x.field.description ?? null] as const)
          .sort((a, b) => byText(a[0], b[0])),
        m.blendable.availableSources
          .map((s) => [s.aliasPath, s.dataMartId] as const)
          .sort((a, b) => byText(a[0], b[0]) || byText(a[1], b[1])),
        ...(hiddenKeys.length ? [hiddenKeys] : []),
      ];
    }),
  ]));
}

const isNotFound = (e: unknown): boolean => {
  for (let c = e; c instanceof Error; c = c.cause) {
    const p = (c as { payload?: { status?: unknown } }).payload;
    if ((c as { status?: unknown }).status === 404 || p?.status === 404) return true;
  }
  return /\b404\b|not found/i.test(describeError(e));
};

/**
 * The hash as it would be computed now. A Data Mart missing from the access list, or one whose fetch says
 * not found, is left out, so the hash changes and the model reads as out of date. Any other failure throws:
 * the hash can't be told. `known` are schemas already read, not fetched again.
 */
export async function currentInputHash(owox: OwoxLike, inputs: Inputs, martIds: string[], known?: ReadonlyMap<string, MartDetail>): Promise<string> {
  const listed = new Set(inputs.marts.map((m) => m.id));
  const present = martIds.filter((id) => listed.has(id));
  const got = await runPool(present.map((id) => async (): Promise<HashMart> => ({
    id, detail: known?.get(id) ?? await fetchMartDetail(owox, id), blendable: await fetchBlendable(owox, id),
  })), POOL);
  const marts: HashMart[] = [];
  for (const r of got) {
    if (r.status === 'fulfilled') marts.push(r.value);
    else if (!isNotFound(r.reason)) throw r.reason;
  }
  return inputHash(inputs, marts);
}

const POOL = 6;
// the ai SDK's schema failures, matched by name: the model answered, but not in the shape asked for
const READING_ERRORS = new Set(['AI_NoObjectGeneratedError', 'AI_TypeValidationError', 'AI_JSONParseError']);
/** A model that answered unreadably, as against a call that never got an answer (timeout, bad key, wrong model). */
export const isReadingError = (e: unknown): boolean =>
  e instanceof Error && (READING_ERRORS.has(e.name) || e.message.startsWith('AI_INVALID:'));
const fail = (code: 'AI_NOT_CONFIGURED' | 'AI_INVALID' | 'AI_REQUEST_FAILED' | 'GOAL_NOT_CONNECTED' | 'GOAL_NO_ACCESS', detail: string, mismatches: string[] = []): BuildResult =>
  ({ ok: false, blocked: { code, detail, mismatches } });

/** What the build is doing, for the progress page. Mart counts run over both detail-loading phases against all visible marts. */
export type BuildStep =
  | { kind: 'read'; what: 'project' | 'contexts' | 'marts' | 'ai'; done: number; total: number | null; finished: boolean; failed?: boolean }
  | { kind: 'contexts'; list: { id: string; name: string }[]; failed?: boolean }
  | { kind: 'check'; id: CheckId; state: CheckState; detail?: string }
  | { kind: 'found'; goal: string | null; classes: string[]; metrics: number };

/** One point of the build checklist. Context points are `context:<id>.<point>`. */
export type CheckId = 'project.description' | 'project.fact' | 'project.plan' | 'project.forecast'
  | 'marts' | 'ai' | 'classes'
  | `context:${string}.description` | `context:${string}.fact` | `context:${string}.plan` | `context:${string}.forecast`;
export type CheckState = 'pending' | 'running' | 'done' | 'missing' | 'failed';

const hasText = (t: string | null) => !!t && t.trim() !== '';

export async function buildModel(args: {
  owox: OwoxLike; generate: Generate | null; userId: string; now: Date; onStep?: (s: BuildStep) => void;
  /** The project's stored core classes; they stay in the result. Null on a first build. */
  existingCore: CoreClass[] | null; industry: Industry | null;
}): Promise<BuildResult> {
  const { owox, generate, userId, now } = args;
  const step = args.onStep ?? (() => undefined);
  const check = (id: CheckId, state: CheckState, detail?: string) => step(detail === undefined ? { kind: 'check', id, state } : { kind: 'check', id, state, detail });
  /** Marks the point a blocked result is about as failed, with the blocked detail. */
  const block = (r: BuildResult): BuildResult => {
    if (!r.ok) {
      const { code, detail } = r.blocked;
      check(code === 'AI_NOT_CONFIGURED' || code === 'AI_INVALID' || code === 'AI_REQUEST_FAILED' ? 'ai' : 'project.fact', 'failed', detail);
    }
    return r;
  };
  if (!generate) return block(fail('AI_NOT_CONFIGURED', 'Ask a project admin to map an AI model to this plugin.'));

  step({ kind: 'read', what: 'project', done: 0, total: null, finished: false });
  let inputs: Inputs;
  try {
    inputs = await fetchInputs(owox);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw new Error(`Couldn't read the project description and Data Marts: ${describeError(e)}`);
  }
  step({ kind: 'read', what: 'project', done: 1, total: 1, finished: true });
  step({ kind: 'contexts', list: inputs.contexts.map((c) => ({ id: c.id, name: c.name })), ...(inputs.contextsOk ? {} : { failed: true }) });
  if (hasText(inputs.projectDescription)) check('project.description', 'done');
  else check('project.description', 'missing', 'The project description is empty.');
  for (const c of inputs.contexts) check(`context:${c.id}.description`, hasText(c.description) ? 'done' : 'missing');
  step(inputs.contextsOk
    ? { kind: 'read', what: 'contexts', done: inputs.contexts.length, total: inputs.contexts.length, finished: true }
    : { kind: 'read', what: 'contexts', done: 0, total: null, finished: false, failed: true });
  const visible = new Set(inputs.marts.map((m) => m.id));

  const links: MartLink[] = extractLinks(inputs.projectDescription, 'project', 0);
  for (const c of inputs.contexts) links.push(...extractLinks(c.description, c.id, links.length));

  const details = new Map<string, MartDetail>();
  const linked = [...new Set(links.flatMap((l) => (l.martId && visible.has(l.martId) ? [l.martId] : [])))];
  const martTotal = inputs.marts.length;
  const counted = new Set<string>();
  const tick = (id: string) => {
    counted.add(id);
    step({ kind: 'read', what: 'marts', done: counted.size, total: martTotal, finished: false });
  };
  step({ kind: 'read', what: 'marts', done: 0, total: martTotal, finished: false });
  check('marts', 'running');
  const got = await runPool(linked.map((id) => async () => {
    try { return await fetchMartDetail(owox, id); } finally { tick(id); }
  }), POOL);
  const failures = new Map<string, unknown>();
  got.forEach((r, i) => { if (r.status === 'fulfilled') details.set(r.value.id, r.value); else failures.set(linked[i]!, r.reason); });
  const titleOf = (id: string) => inputs.marts.find((m) => m.id === id)?.title ?? id;
  const buildFailed = (id: string, e: unknown) => new Error(`BUILD_FAILED: couldn't load ${titleOf(id)}: ${describeError(e)}`);
  const dateFields: Record<string, string[]> = {};
  for (const [id, d] of details) dateFields[id] = flattenFields(d.fields).filter((x) => DATE_TYPES.has(x.field.type.toUpperCase())).map((x) => x.path);

  let ai;
  step({ kind: 'read', what: 'ai', done: 0, total: null, finished: false });
  check('ai', 'running');
  for (const id of ['project.fact', 'project.plan', 'project.forecast'] as const) check(id, 'running');
  try {
    ai = await interpret(generate, { projectDescription: inputs.projectDescription, contexts: inputs.contexts, links, dateFields, marts: inputs.marts.map((m) => ({ id: m.id, title: m.title, description: m.description })) });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    if (!isReadingError(e)) return block(fail('AI_REQUEST_FAILED', "The request to the AI provider failed or timed out.", [describeError(e)]));
    return block(fail('AI_INVALID', "The AI's reading of the descriptions doesn't match the Data Mart schemas.", [e instanceof Error ? e.message : String(e)]));
  }
  check('ai', 'done');
  // the critical metric of the project and of each context decides its fact, plan and forecast points
  const linkOk = (i: number | null) => { const l = i === null ? undefined : links[i]; return !!l && !l.placeholder && !!l.martId && !!l.field; };
  const resolve = (m: AiMetric | undefined, id: (p: 'fact' | 'plan' | 'forecast') => CheckId) => {
    const fact = linkOk(m?.factLink ?? null);
    check(id('fact'), fact ? 'done' : 'missing', m ? 'The Critical number has no link to a Data Mart field.' : 'There is no Critical number row.');
    check(id('plan'), linkOk(m?.planLink ?? null) ? 'done' : 'missing');
    // a metric's forecast source doesn't exist at build time, so extrapolating the fact is the only path
    if (fact && m?.factDateField) check(id('forecast'), 'done', 'Extrapolated from the fact');
    else check(id('forecast'), 'missing');
  };
  // the project's points follow the goal metric, as validate does; a context's follow its critical metric
  resolve(ai.metrics.find((m) => m.ref === ai.goal.metricRef), (p) => `project.${p}`);
  for (const c of inputs.contexts) resolve(ai.metrics.find((x) => x.role === 'critical' && x.source === c.id), (p) => `context:${c.id}.${p}`);

  const goalMetric = ai.metrics.find((m) => m.ref === ai.goal.metricRef);
  const gl = goalMetric && goalMetric.factLink !== null ? links[goalMetric.factLink] : undefined;
  if (ai.goal.status === 'ok' && gl?.martId && visible.has(gl.martId) && failures.has(gl.martId)) throw buildFailed(gl.martId, failures.get(gl.martId));

  const v = validate({ ai, links, details, visible });
  if (!v.ok) return block(v);
  if (!visible.has(v.goal.martId)) return block(fail('GOAL_NO_ACCESS', "You can't access the Data Mart that owns the critical number. Ask a project admin with access to build the model."));
  step({ kind: 'read', what: 'ai', done: 1, total: 1, finished: true });
  step({ kind: 'found', goal: `${goalMetric?.alias ?? v.goal.field} (${titleOf(v.goal.martId)})`, classes: [], metrics: 0 });

  const loaded = await runPool(inputs.marts.map((m) => async (): Promise<MartNode> => {
    try {
      const detail = details.get(m.id) ?? await fetchMartDetail(owox, m.id);
      const blendable: Blendable = await fetchBlendable(owox, m.id);
      return { id: m.id, title: m.title, contexts: m.contexts, detail, blendable };
    } finally {
      if (!counted.has(m.id)) tick(m.id);
    }
  }), POOL);
  step({ kind: 'read', what: 'marts', done: martTotal, total: martTotal, finished: true });
  check('marts', 'done');
  check('classes', 'running');
  const nodes = loaded.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  loaded.forEach((r, i) => { if (r.status === 'rejected') failures.set(inputs.marts[i]!.id, r.reason); });

  const main = { id: v.goal.martId };
  if (!nodes.some((n) => n.id === main.id)) throw buildFailed(main.id, failures.get(main.id));

  const edges = buildEdges(nodes, visible);
  // a Data Mart without a primary key is neither drawn nor walked through
  const classable = new Set(nodes.filter((n) => hasPrimaryKey(n.detail)).map((n) => n.id));
  const depths = classDepths(main.id, edges, classable);

  const inbound = inboundCounts(edges);
  const keyed = new Set(nodes.filter((n) => singleKey(n.detail)).map((n) => n.id));
  const ranked = rankCore({ goalId: main.id, nodes: nodes.map((n) => ({ id: n.id, title: n.title, singleKey: keyed.has(n.id) })), edges });
  // picks the AI named that can't be core (not loaded, no single-column key, the goal) are dropped; a repeat collapses to the first
  const picks: CoreClass[] = [];
  for (const p of ai.coreClasses) if (keyed.has(p.martId) && p.martId !== main.id && !picks.some((x) => x.martId === p.martId)) picks.push(p);
  const count = INDUSTRIES.find((i) => i.id === (args.industry ?? 'other'))!.count;
  const core = mergeCore(args.existingCore, picks, ranked, count);
  // a core class the walk didn't reach is still drawn when it connects to the goal
  for (const c of core) {
    if (depths.has(c.martId) || !classable.has(c.martId)) continue;
    if (edges.some((e) => (e.from === main.id && e.to === c.martId) || (e.from === c.martId && e.to === main.id))) depths.set(c.martId, 1);
  }

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
    classes.push({ id: n.id, martId: n.id, title: n.title, contexts: n.contexts, depth, keyMetricId: sorted[0]?.id ?? null, metricIds: sorted.map((m) => m.id), shown: true, core: false, inbound: 0 });
  }
  classes.sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  metrics.sort((a, b) => a.id.localeCompare(b.id));

  const goalClass = classes.find((c) => c.id === main.id);
  const goalDef = metrics.find((m) => m.id === v.goal.metricId);
  check('classes', classes.length > 0 ? 'done' : 'missing', classes.length > 0 ? undefined : 'No classes were found.');
  step({
    kind: 'found',
    goal: goalClass ? `${goalDef?.alias ?? goalClass.title} (${goalClass.title})` : null,
    classes: classes.map((c) => c.title),
    metrics: metrics.length,
  });

  const model = applyCore({

      version: 3,
      inputHash: inputHash(inputs, nodes.filter((n) => depths.has(n.id))),
      builtAt: now.toISOString(),
      builtBy: userId,
      editedAt: null,
      editedBy: null,
      goal: { classId: main.id, metricId: v.goal.metricId, goalMartId: v.goal.martId, viaFallback: false },
      classes,
      edges: edges.filter((e) => depths.has(e.from) && depths.has(e.to)).map((e) => ({ from: e.from, to: e.to, fields: e.fields })),
      metrics,
  }, core, inbound);
  return { ok: true, model, core: { classes: core, fromDescription: picks.length > 0 } };
}
