import type { Model, ProjectSettings } from '../types';
import { allFieldPaths, DATE_TYPES, fetchBlendable, fetchInputs, fetchMartDetail, flattenFields, type Inputs, type MartDetail, type OwoxLike } from '../owox/sources';
import { buildEdges, classDepths, hasDateField, hasPrimaryKey, type MartNode } from '../model/graph';
import { INDUSTRIES, inboundCounts, rankCore, singleKey } from '../model/core';
import { checkHealth } from '../model/health';
import { currentInputHash } from '../model/build';
import { runPool } from '../lib/pool';
import { describeError } from '../lib/errors';
import { criticalRow, findMetricRows, isFieldLink, type MetricRow } from './tables';
import { codeSuggestion, type SuggestContext } from './suggest';
import { aiQuestion, isAiCheck } from './suggestAi';
import type { Check, CheckStatus, Fix, GroupId } from './types';

export interface CheckupArgs {
  owox: OwoxLike; hasAi: boolean; model: Model | null; projectId: string; settings: ProjectSettings;
  /** The whole list, each time a check changes. */
  onUpdate: (checks: Check[]) => void;
  /** Called once with what the run loaded, so a later AI suggestion reads the same facts. */
  onContext?: (ctx: SuggestContext) => void;
}

/** Labels by check id; per-context checks use `context.<name>`. */
export const LABELS: Record<string, string> = {
  'plugin.ai': 'An AI credential is mapped',
  'project.description': "The description isn't empty",
  'project.table': 'It has a Metrics table',
  'project.critical': 'It has a Critical number row',
  'project.fact': "The Critical number's fact links a Data Mart field",
  'project.plan': "The Critical number's plan links a Data Mart field",
  'project.shape': "The plan's shape is known",
  'project.links': 'Every Data Mart and field linked in the description exists',
  'goal.access': 'Goal Data Mart: it is published and you can access it',
  'goal.field': 'Goal Data Mart: the goal field exists in it',
  'goal.pk': 'Goal Data Mart: it has a primary key',
  'goal.date': 'Goal Data Mart: it has a date field',
  'core.business': 'The description describes the business model',
  'core.industry': 'The industry is set',
  'core.set': 'Core classes are set',
  'core.keys': 'Each core class has a unique ID (a single-column primary key)',
  'core.toGoal': 'Each core class connects directly to the goal class',
  'core.linked': 'Core classes connect to each other',
  'core.count': 'The number of core classes fits the industry',
  'core.missing': "A dictionary Data Mart with many inbound references isn't core",
  'contexts.exist': 'At least two contexts exist',
  'context.description': "The description isn't empty",
  'context.marts': 'At least one Data Mart is in it',
  'context.fact': 'It has a critical number row with a fact',
  'context.plan': 'A metric row links a plan',
  'context.links': 'Every linked Data Mart and field exists',
  'connections.reachable': "The goal is reachable: you can access its Data Mart, or a calculated field references it",
  'connections.any': 'Calculated fields reference other Data Marts',
  'connections.facts': 'Each Data Mart with a fact link connects to the goal',
  'connections.pk': 'Each Data Mart with a fact link has a primary key',
  'connections.date': 'Each Data Mart with a fact link has a date field',
  'model.built': 'The model is built',
  'model.health': 'The saved model has no broken references',
  'model.fresh': 'The saved model matches the descriptions',
  'model.keys': 'Each core class has a key metric',
  'model.plans': 'Each shown metric of the goal and core classes has a plan',
  'model.history': 'Who last changed the model',
};
/** What each check is for, by check id (per-context ids as in LABELS). */
export const PURPOSES: Record<string, string> = {
  'plugin.ai': 'Gyroscope uses the AI to read descriptions and draft answers. Without a credential, only suggestions that code can decide are offered.',
  'project.description': 'The project description tells Gyroscope, and everyone who opens it, what the business does and which numbers matter.',
  'project.table': 'The Metrics table in the description names the critical number, its plan and its fact.',
  'project.critical': 'The critical number is the one number that says whether the business is on track. Gyroscope puts its class in the center and judges every other card by how it feeds it.',
  'project.fact': 'The fact is the Data Mart field that holds the critical number, so Gyroscope can read it.',
  'project.plan': 'The plan is what the critical number should be. Without it the goal shows with no target to compare against.',
  'project.shape': 'A plan is daily, cumulative or a level. Knowing which lets Gyroscope compare the fact with the plan for the same day.',
  'project.links': 'Every link in the description must open a Data Mart and a field you can see, or the numbers behind it are missing.',
  'goal.access': 'The goal Data Mart must be published and open to you, or its class cannot be drawn.',
  'goal.field': 'The field named as the critical number must exist in the goal Data Mart.',
  'goal.pk': 'A class needs a primary key to be counted and joined to the cards around it.',
  'goal.date': 'A date field lets the goal show its number for a period and a trend.',
  'core.business': 'Core classes are found from the description of the business model. It should name the main Data Marts: who buys, what is bought, where they come from.',
  'core.industry': 'The closest business model suggests how many core classes to expect and which ones typically matter.',
  'core.set': 'Core classes are the 3 to 7 dictionary classes drawn around the critical number in the ontology view.',
  'core.keys': 'A core class needs a single-column primary key, so other Data Marts can reference it by one ID.',
  'core.toGoal': 'A core class that the goal Data Mart references directly can be drawn next to the goal and counted in its numbers.',
  'core.linked': 'References between core classes show how the business fits together, for example who bought what.',
  'core.count': 'Each business model has a typical number of core classes. Far more or fewer than that usually means a missing or a misplaced class.',
  'core.missing': 'A dictionary Data Mart that many others reference is probably a core class of the business.',
  'contexts.exist': 'Contexts are the teams or areas that move the critical number, such as Marketing or Sales. Two or more give the flow view something to group by.',
  'context.description': 'A context description says what the team owns and holds its own Metrics table.',
  'context.marts': 'The Data Marts in a context are the ones its team works with.',
  'context.fact': 'A critical number row with a fact gives the context its own number to judge it by.',
  'context.plan': 'A plan for the context number shows whether the team is on track.',
  'context.links': 'Every link in the context description must open a Data Mart and a field you can see.',
  'connections.reachable': 'Gyroscope needs to read the goal Data Mart, or a calculated field that references it, to draw the center of the canvas.',
  'connections.any': 'Calculated fields that reference other Data Marts draw the lines between cards and decide their order.',
  'connections.facts': 'A Data Mart with a fact link is drawn only when it connects to the goal.',
  'connections.pk': 'A Data Mart with a fact link needs a primary key to be a class.',
  'connections.date': 'Without a date field a Data Mart shows in the ontology view but gets no numbers in the flow view.',
  'model.built': 'The model holds the classes, metrics and edges the canvas draws. Nothing shows until it is built.',
  'model.health': 'The model refers to Data Marts and fields. When one is renamed or removed, its card shows no numbers.',
  'model.fresh': 'The model is built from the descriptions. When they change, a rebuild brings it up to date.',
  'model.keys': 'The key metric is the number a class shows first. A core class without one shows no headline number.',
  'model.plans': 'A plan lets a metric show whether it is on track. The goal and core classes are where it matters most.',
  'model.history': 'Shows who built or last changed the shared model, and when.',
};
const purpose = (id: string) => PURPOSES[id.startsWith('context:') ? `context.${id.slice(id.indexOf('.') + 1)}` : id] ?? '';
const FIXED: [GroupId, string][] = [['critical', 'project.description'], ['critical', 'project.table'], ['critical', 'project.critical'], ['critical', 'project.fact'], ['critical', 'project.links'],
  ['critical', 'goal.access'], ['critical', 'goal.field'], ['critical', 'goal.pk'], ['critical', 'goal.date'], ['critical', 'project.plan'], ['critical', 'project.shape'],
  ['core', 'core.business'], ['core', 'core.industry'], ['core', 'core.set'], ['core', 'core.keys'], ['core', 'core.toGoal'], ['core', 'core.linked'], ['core', 'core.count'], ['core', 'core.missing'],
  ['contexts', 'contexts.exist'],
  ['connections', 'connections.reachable'], ['connections', 'connections.any'], ['connections', 'connections.facts'], ['connections', 'connections.pk'], ['connections', 'connections.date'],
  ['metrics', 'model.built'], ['metrics', 'model.health'], ['metrics', 'model.fresh'], ['metrics', 'model.keys'], ['metrics', 'model.plans'],
  ['housekeeping', 'plugin.ai'], ['housekeeping', 'model.history']];
const label = (id: string) => LABELS[id.startsWith('context:') ? `context.${id.slice(id.indexOf('.') + 1)}` : id] ?? id;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Runs every check of the spec. Never throws; resolves with the final list. */
export async function runCheckup({ owox: raw, hasAi, model, projectId, settings, onUpdate, onContext }: CheckupArgs): Promise<Check[]> {
  // Every Data Mart schema is requested once per run, however many checks (and checkHealth) ask for it.
  const cache = new Map<string, Promise<unknown>>();
  // Object.create keeps every other member (prototype methods, getters) bound to the real client.
  const owox: OwoxLike = Object.create(raw, { getJson: { value: <T,>(path: string, ...rest: unknown[]): Promise<T> => {
    const call = () => (raw.getJson as (...a: unknown[]) => Promise<T>).call(raw, path, ...rest);
    if (!/^\/api\/data-marts\/[^/]+(\/blendable-schema)?$/.test(path)) return call();
    if (!cache.has(path)) cache.set(path, call());
    return cache.get(path) as Promise<T>;
  } } });
  const map = new Map<string, Check>();
  const publish = () => onUpdate([...map.values()]);
  const add = (id: string, group: GroupId, context?: Check['context']) => { map.set(id, { id, group, label: label(id), purpose: purpose(id), status: 'running', ...(context ? { context } : {}) }); };
  /** Settles a check; the fix shows only when it isn't passing. */
  const put = (id: string, status: CheckStatus, detail?: string, fix?: Fix | Fix[]) => {
    const c = map.get(id)!;
    const { detail: _d, fix: _f, suggestion: _s, ...rest } = c;
    map.set(id, { ...rest, status, ...(detail !== undefined ? { detail } : {}), ...(fix ? { fix } : {}) });
    publish();
  };
  const skip = (id: string, dep: string) => put(id, 'skip', `Needs: ${label(dep)}`);
  const failRunning = (match: (c: Check) => boolean, detail: string) => {
    for (const c of [...map.values()]) if (c.status === 'running' && match(c)) put(c.id, 'fail', detail);
  };
  /** A throw fails the still-running checks whose id starts with `prefix`, or that `prefix` matches. */
  const guard = async (prefix: string | ((id: string) => boolean), fn: () => Promise<void> | void) => {
    const match = typeof prefix === 'string' ? (id: string) => id.startsWith(prefix) : prefix;
    try { await fn(); } catch (e) { failRunning((c) => match(c.id), describeError(e)); }
  };
  const owoxFix = (fixLabel: string, path: string): Fix => ({ kind: 'owox', label: fixLabel, path: `/ui/${projectId}${path}` });
  const martFix = (id: string, title?: string): Fix => owoxFix(`Open ${title ?? 'the Data Mart'}`, `/data-marts/${id}/data-setup`);

  for (const [g, id] of FIXED) add(id, g);
  publish();

  put('plugin.ai', hasAi ? 'ok' : 'fail', hasAi ? undefined : 'No AI credential is mapped to Gyroscope', hasAi ? undefined : owoxFix('Plugins', '/plugins'));

  let inputs: Inputs;
  try { inputs = await fetchInputs(owox); }
  catch (e) { failRunning(() => true, `Couldn't read the project: ${describeError(e)}`); return [...map.values()]; }

  const titles = new Map(inputs.marts.map((m) => [m.id, m.title]));
  const visible = new Set(titles.keys());
  const details = new Map<string, Promise<MartDetail>>();
  const known = new Map<string, MartDetail>();
  /** One fetch per Data Mart per run. */
  const detail = (id: string) => {
    let p = details.get(id);
    if (!p) { p = fetchMartDetail(owox, id).then((d) => { known.set(id, d); return d; }); details.set(id, p); }
    return p;
  };

  const projectRows = findMetricRows(inputs.projectDescription, 'project');
  const contextRows = new Map(inputs.contexts.map((c) => [c.id, findMetricRows(c.description, c.id)]));
  for (const c of inputs.contexts) for (const k of ['description', 'marts', 'fact', 'plan', 'links']) add(`context:${c.id}.${k}`, 'contexts', { id: c.id, name: c.name });
  publish();

  /** Plan and Fact links that name a field must name a Data Mart you can see, with that field. */
  const linkProblems = async (rows: MetricRow[]) => {
    const links = rows.flatMap((r) => [...r.plan, ...r.fact]).filter(isFieldLink);
    const problems = (await Promise.all(links.map(async (l) => {
      if (!visible.has(l.martId!)) return `${l.text}: Data Mart not found or not accessible`;
      try {
        const d = await detail(l.martId!);
        return allFieldPaths(d.fields).has(l.field!) ? null : `${l.text}: field ${l.field} isn't in ${d.title}`;
      } catch (e) { return `${l.text}: ${describeError(e)}`; }
    }))).filter((p): p is string => !!p);
    return { n: links.length, problems };
  };
  const putLinks = async (id: string, rows: MetricRow[], fix: Fix) => {
    const { n, problems } = await linkProblems(rows);
    if (problems.length) put(id, 'fail', problems.join('; '), fix);
    else put(id, 'ok', n ? `${n} links` : 'No links');
  };

  const projectFix = owoxFix('Project settings', '/project-settings');
  const critical = criticalRow(projectRows);
  const factLink = critical?.fact[0];
  const factOk = !!critical && !!factLink && isFieldLink(factLink);
  const goalId = factOk ? factLink.martId! : '';
  const goalField = factOk ? factLink.field! : '';

  const projectGroup = () => guard('project.', async () => {
    const desc = !!inputs.projectDescription?.trim();
    if (desc) put('project.description', 'ok'); else put('project.description', 'fail', 'The project description is empty', projectFix);
    if (!desc) skip('project.table', 'project.description');
    else if (!projectRows.length) put('project.table', 'fail', 'No Metrics table with Role, Plan and Fact columns', [{ kind: 'snippet', label: 'Copy a Metrics table' }, projectFix]);
    else put('project.table', 'ok');
    if (map.get('project.table')!.status !== 'ok') skip('project.critical', 'project.table');
    else if (!critical) put('project.critical', 'fail', 'No Critical number row', projectFix);
    else put('project.critical', 'ok', critical.metric);
    if (!critical) { for (const id of ['fact', 'plan', 'shape']) skip(`project.${id}`, 'project.critical'); }
    else {
      if (factOk) put('project.fact', 'ok', `${critical.metric} (${titles.get(goalId) ?? factLink.text})`);
      else put('project.fact', 'fail', "The Critical number's Fact doesn't link a Data Mart field", projectFix);
      if (critical.plan.some(isFieldLink)) put('project.plan', 'ok');
      else put('project.plan', 'warn', 'No plan: the goal shows without one', projectFix);
      // the plan values aren't read here; the saved model holds the shape the build detected
      const shape = model?.metrics.find((m) => m.id === model.goal.metricId)?.plan?.shape;
      if (map.get('project.plan')!.status !== 'ok') skip('project.shape', 'project.plan');
      else if (shape) put('project.shape', 'ok', shape);
      else if (model) put('project.shape', 'recommend', 'Not known yet: rebuild the model to detect it', { kind: 'tab', label: 'Open Metrics', tab: 'ontology' });
      else put('project.shape', 'recommend', 'Not known yet: build the model to detect it', projectFix);
    }
    await putLinks('project.links', projectRows, projectFix);
  });

  const goalGroup = () => guard('goal.', async () => {
    if (!factOk) { for (const id of ['access', 'field', 'pk', 'date']) skip(`goal.${id}`, 'project.fact'); return; }
    const title = titles.get(goalId);
    const fix = martFix(goalId, title);
    if (!title) {
      // its own page may be closed to this member, so the Data Marts list comes too
      put('goal.access', 'fail', "Not published, or you can't access it", [fix, owoxFix('Data Marts', '/data-marts')]);
      for (const id of ['field', 'pk', 'date']) skip(`goal.${id}`, 'goal.access');
      return;
    }
    put('goal.access', 'ok', title);
    let d: MartDetail;
    try { d = await detail(goalId); }
    catch (e) { failRunning((c) => c.id.startsWith('goal.'), describeError(e)); return; }
    if (allFieldPaths(d.fields).has(goalField)) put('goal.field', 'ok'); else put('goal.field', 'fail', `Field ${goalField} isn't in ${d.title}`, fix);
    if (hasPrimaryKey(d)) put('goal.pk', 'ok'); else put('goal.pk', 'fail', "No primary key: it can't be a class", fix);
    if (flattenFields(d.fields).some((f) => DATE_TYPES.has(f.field.type.toUpperCase()))) put('goal.date', 'ok'); else put('goal.date', 'fail', 'No date field', fix);
  });

  const contextsGroup = () => guard((id) => id === 'contexts.exist' || id.startsWith('context:'), async () => {
    const fix = owoxFix('Contexts', '/project-settings/contexts');
    if (!inputs.contextsOk) put('contexts.exist', 'fail', "Contexts couldn't be read", fix);
    else if (inputs.contexts.length < 2) put('contexts.exist', 'warn', inputs.contexts.length ? 'Only 1 context' : 'No contexts', fix);
    else put('contexts.exist', 'ok', `${inputs.contexts.length} contexts`);
    await Promise.all(inputs.contexts.map((c) => guard(`context:${c.id}.`, async () => {
      const p = `context:${c.id}`;
      const rows = contextRows.get(c.id)!;
      if (c.description?.trim()) put(`${p}.description`, 'ok'); else put(`${p}.description`, 'recommend', 'Empty description', fix);
      const n = inputs.marts.filter((m) => m.contexts.some((x) => x.id === c.id)).length;
      if (n) put(`${p}.marts`, 'ok', `${n} Data Marts`); else put(`${p}.marts`, 'warn', 'No Data Marts in this context', fix);
      if (criticalRow(rows)?.fact.some(isFieldLink)) put(`${p}.fact`, 'ok'); else put(`${p}.fact`, 'warn', 'No Critical number row with a fact', fix);
      if (rows.some((r) => r.plan.some(isFieldLink))) put(`${p}.plan`, 'ok'); else put(`${p}.plan`, 'recommend', 'No metric row links a plan', fix);
      await putLinks(`${p}.links`, rows, fix);
    })));
  });

  /** Every visible Data Mart with its schema, and the references between them; built once, for connections and core. */
  let graphP: Promise<{ nodes: MartNode[]; edges: ReturnType<typeof buildEdges> }> | undefined;
  const graph = () => (graphP ??= (async () => {
    const nodes: MartNode[] = [];
    await runPool(inputs.marts.map((m) => async () => {
      const d = await detail(m.id);
      const blendable = await fetchBlendable(owox, m.id);
      nodes.push({ id: m.id, title: m.title, contexts: m.contexts, detail: d, blendable });
    }), 6);
    return { nodes, edges: buildEdges(nodes, visible, goalId) };
  })());

  const connectionsGroup = () => guard('connections.', async () => {
    if (!factOk) { for (const id of ['reachable', 'any', 'facts', 'pk', 'date']) skip(`connections.${id}`, 'project.fact'); return; }
    const { nodes, edges } = await graph();
    const goalFix = martFix(goalId, titles.get(goalId));
    const main = visible.has(goalId) ? goalId : null;
    if (!main) put('connections.reachable', 'fail', "You can't access the goal Data Mart", goalFix);
    else put('connections.reachable', 'ok', `You can access ${titles.get(main) ?? main}`);
    if (edges.length) put('connections.any', 'ok', `${edges.length} connections`);
    else put('connections.any', 'warn', 'No calculated field references another Data Mart', owoxFix('Data Marts', '/data-marts'));

    const factIds = [...new Set([...projectRows, ...[...contextRows.values()].flat()].flatMap((r) => r.fact.filter(isFieldLink).map((l) => l.martId!)))].filter((id) => visible.has(id));
    const names = (ids: string[]) => ids.map((id) => titles.get(id) ?? id).join(', ');
    // every Data Mart a warning names gets its own link, not only the first
    const martFixes = (ids: string[]) => ids.map((id) => martFix(id, titles.get(id)));
    const lacking = (has: (d: MartDetail) => boolean) => factIds.filter((id) => { const n = nodes.find((x) => x.id === id); return n && !has(n.detail); });
    // the goal class stays on the canvas without a key or a date field; the goal checks report those
    const noPk = lacking(hasPrimaryKey).filter((id) => id !== main);
    const noDate = lacking(hasDateField).filter((id) => id !== main);
    if (!main) skip('connections.facts', 'connections.reachable');
    else {
      const depths = classDepths(main, edges, new Set(nodes.filter((n) => hasPrimaryKey(n.detail)).map((n) => n.id)));
      // a Data Mart missing a primary key or a date field is reported by its own check, not as unconnected
      const off = factIds.filter((id) => !depths.has(id) && !noPk.includes(id) && !noDate.includes(id));
      if (off.length) put('connections.facts', 'warn', `Not connected to the goal, so not on the canvas: ${names(off)}`, martFixes(off));
      else put('connections.facts', 'ok');
    }
    if (noPk.length) put('connections.pk', 'warn', `No primary key: ${names(noPk)}`, martFixes(noPk));
    else put('connections.pk', 'ok');
    if (noDate.length) put('connections.date', 'recommend', `No date field: shows in the ontology view, with no numbers: ${names(noDate)}`, martFixes(noDate));
    else put('connections.date', 'ok');
  });

  const coreGroup = () => guard('core.', async () => {
    const ids = ['business', 'industry', 'set', 'keys', 'toGoal', 'linked', 'count', 'missing'];
    if (!factOk) { for (const id of ids) skip(`core.${id}`, 'project.fact'); return; }
    const { nodes, edges } = await graph();
    const industry = INDUSTRIES.find((i) => i.id === (settings.industry ?? 'other')) ?? INDUSTRIES.find((i) => i.id === 'other')!;
    const nodeOf = new Map(nodes.map((n) => [n.id, n]));
    const keyed = (id: string) => { const n = nodeOf.get(id); return !!n && singleKey(n.detail); };
    // the saved list, or what the build would pick
    const coreIds = settings.coreClasses ? settings.coreClasses.map((c) => c.martId)
      : rankCore({ goalId, nodes: nodes.map((n) => ({ id: n.id, title: n.title, singleKey: singleKey(n.detail) })), edges }).slice(0, industry.count);
    const name = (id: string) => titles.get(id) ?? id;
    const names = (list: string[]) => list.map(name).join(', ');
    const fixes = (list: string[]) => list.filter((id) => visible.has(id)).map((id) => martFix(id, name(id)));
    const linkedPair = (a: string, b: string) => edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));

    const desc = (inputs.projectDescription ?? '').toLowerCase();
    const described = coreIds.some((id) => (titles.has(id) && desc.includes(titles.get(id)!.toLowerCase())) || desc.includes(`/data-marts/${id}`));
    if (described) put('core.business', 'ok'); else put('core.business', 'warn', "The project description doesn't describe the business model", projectFix);

    if (settings.industry) put('core.industry', 'ok', industry.label); else put('core.industry', 'warn', 'No industry set');

    const n = settings.coreClasses?.length ?? 0;
    if (!settings.coreClasses) put('core.set', 'warn', 'No core classes set');
    else if (n < 3 || n > 7) put('core.set', 'warn', `${plural(n, 'core class', 'core classes')}: it takes 3 to 7`);
    else put('core.set', 'ok', names(coreIds));

    if (!coreIds.length) { for (const id of ['keys', 'toGoal', 'linked']) skip(`core.${id}`, 'core.set'); }
    else {
      const noKey = coreIds.filter((id) => !keyed(id));
      if (noKey.length) put('core.keys', 'warn', `No single-column primary key: ${names(noKey)}`, fixes(noKey)); else put('core.keys', 'ok');
      const apart = coreIds.filter((id) => id !== goalId && !linkedPair(id, goalId));
      if (apart.length) put('core.toGoal', 'warn', `No direct reference with the goal: ${names(apart)}`, fixes(apart)); else put('core.toGoal', 'ok');
      const pairs: string[] = [];
      for (let i = 0; i < coreIds.length; i++) for (let j = i + 1; j < coreIds.length; j++) if (!linkedPair(coreIds[i]!, coreIds[j]!)) pairs.push(`${name(coreIds[i]!)} and ${name(coreIds[j]!)}`);
      if (pairs.length) put('core.linked', 'recommend', `No reference between ${pairs.slice(0, 3).join('; ')}${pairs.length > 3 ? ` and ${pairs.length - 3} more` : ''}`);
      else put('core.linked', 'ok');
    }

    if (!settings.industry) skip('core.count', 'core.industry');
    else if (coreIds.length !== industry.count) put('core.count', 'recommend', `${plural(coreIds.length, 'core class', 'core classes')}; ${industry.label} usually has ${industry.count}`);
    else put('core.count', 'ok');

    const inbound = inboundCounts(edges);
    const missing = nodes.filter((x) => x.id !== goalId && !coreIds.includes(x.id) && singleKey(x.detail) && (inbound.get(x.id) ?? 0) >= 3).sort((a, b) => (inbound.get(b.id) ?? 0) - (inbound.get(a.id) ?? 0));
    if (missing.length) put('core.missing', 'recommend', missing.map((x) => `${x.title} (${inbound.get(x.id)} inbound)`).join(', '), fixes(missing.map((x) => x.id)));
    else put('core.missing', 'ok');
  });

  const modelGroup = () => guard((id) => id.startsWith('model.'), async () => {
    const none = ['health', 'fresh', 'keys', 'plans', 'history'];
    if (!model) { put('model.built', 'fail', 'No model built yet'); for (const id of none) put(`model.${id}`, 'skip', 'No model built yet'); return; }
    put('model.built', 'ok');
    const fix: Fix = { kind: 'tab', label: 'Open Metrics', tab: 'ontology' };
    const coreClasses = model.classes.filter((c) => c.core);
    const noKey = coreClasses.filter((c) => !c.keyMetricId);
    if (noKey.length) put('model.keys', 'recommend', `No key metric: ${noKey.map((c) => c.title).join(', ')}`, fix); else put('model.keys', 'ok');
    const watched = new Set([model.goal.classId, ...coreClasses.map((c) => c.id)]);
    const noPlan = model.metrics.filter((m) => m.shown && !m.plan && watched.has(m.martId));
    if (noPlan.length) put('model.plans', 'recommend', `No plan: ${noPlan.slice(0, 5).map((m) => m.alias).join(', ')}${noPlan.length > 5 ? ` and ${noPlan.length - 5} more` : ''}`, fix); else put('model.plans', 'ok');
    const by = model.editedBy ?? model.builtBy;
    const at = new Date(model.editedBy ? model.editedAt ?? model.builtAt : model.builtAt);
    const when = isNaN(at.getTime()) ? '' : `, ${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    put('model.history', 'ok', `${model.editedBy ? 'Last edited' : 'Built'} by ${by}${when}`);
    const { issues } = await checkHealth(owox, model, visible);
    if (issues.length) put('model.health', 'warn', plural(issues.length, 'broken reference', 'broken references'), fix); else put('model.health', 'ok');
    if (!inputs.contextsOk) { put('model.fresh', 'skip', "Contexts couldn't be read"); return; }
    const hash = await currentInputHash(owox, inputs, model.classes.map((c) => c.id), known);
    if (hash !== model.inputHash) put('model.fresh', 'warn', 'The descriptions changed since the model was built', fix); else put('model.fresh', 'ok');
  });

  /** Code answers for checks that aren't passing; checks only the AI can answer get an empty one, so the tab offers "Suggest an answer". */
  const attachSuggestions = async () => {
    let g: Awaited<ReturnType<typeof graph>> = { nodes: [], edges: [] };
    try { g = await graph(); } catch { /* suggestions that need the graph are left out */ }
    const ctx: SuggestContext = { inputs, nodes: g.nodes, edges: g.edges, goalId: factOk ? goalId : null, settings, projectId };
    onContext?.(ctx);
    for (const c of [...map.values()]) {
      if (c.status === 'ok' || c.status === 'skip' || c.status === 'running') continue;
      let s: Check['suggestion'] | null = null;
      try { s = codeSuggestion(c.id, ctx); } catch { /* no suggestion */ }
      if (!s && isAiCheck(c.id)) s = { question: aiQuestion(c.id, ctx), options: [], ai: true, target: () => ({ kind: 'settings', patch: {} }) };
      if (s) map.set(c.id, { ...c, suggestion: s });
    }
    publish();
  };

  await Promise.all([projectGroup(), goalGroup(), contextsGroup(), connectionsGroup(), coreGroup(), modelGroup()]);
  await attachSuggestions();
  return [...map.values()];
}
