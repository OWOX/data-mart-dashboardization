import type { Model } from '../types';
import { allFieldPaths, DATE_TYPES, fetchBlendable, fetchInputs, fetchMartDetail, flattenFields, type Inputs, type MartDetail, type OwoxLike } from '../owox/sources';
import { buildEdges, classDepths, hasDateField, hasPrimaryKey, type MartNode } from '../model/graph';
import { checkHealth } from '../model/health';
import { currentInputHash } from '../model/build';
import { runPool } from '../lib/pool';
import { describeError } from '../lib/errors';
import { criticalRow, findMetricRows, isFieldLink, type MetricRow } from './tables';
import type { Check, CheckStatus, Fix, GroupId } from './types';

export interface CheckupArgs {
  owox: OwoxLike; hasAi: boolean; model: Model | null; projectId: string;
  /** The whole list, each time a check changes. */
  onUpdate: (checks: Check[]) => void;
}

/** Labels by check id; per-context checks use `context.<name>`. */
export const LABELS: Record<string, string> = {
  'plugin.ai': 'An AI credential is mapped',
  'project.description': "The description isn't empty",
  'project.table': 'It has a Metrics table',
  'project.critical': 'It has a Critical number row',
  'project.fact': "The Critical number's fact links a Data Mart field",
  'project.plan': "The Critical number's plan links a Data Mart field",
  'project.links': 'Every Data Mart and field linked in the description exists',
  'goal.access': 'Goal Data Mart: it is published and you can access it',
  'goal.field': 'Goal Data Mart: the goal field exists in it',
  'goal.pk': 'Goal Data Mart: it has a primary key',
  'goal.date': 'Goal Data Mart: it has a date field',
  'contexts.exist': 'At least two contexts exist',
  'context.description': "The description isn't empty",
  'context.marts': 'At least one Data Mart is in it',
  'context.fact': 'A metric row links a fact',
  'context.plan': 'A metric row links a plan',
  'context.links': 'Every linked Data Mart and field exists',
  'connections.reachable': "The goal is reachable: you can access its Data Mart, or a calculated field references it",
  'connections.any': 'Calculated fields reference other Data Marts',
  'connections.facts': 'Each Data Mart with a fact link connects to the goal',
  'connections.pk': 'Each Data Mart with a fact link has a primary key',
  'connections.date': 'Each Data Mart with a fact link has a date field',
  'model.health': 'The saved model has no broken references',
  'model.fresh': 'The saved model matches the descriptions',
};
const FIXED: [GroupId, string][] = [['heading', 'project.description'], ['heading', 'project.table'], ['heading', 'project.critical'], ['heading', 'project.fact'], ['heading', 'project.plan'], ['heading', 'project.links'],
  ['heading', 'goal.access'], ['heading', 'goal.field'], ['heading', 'goal.pk'], ['heading', 'goal.date'], ['drivers', 'contexts.exist'],
  ['connections', 'connections.reachable'], ['connections', 'connections.any'], ['connections', 'connections.facts'], ['connections', 'connections.pk'], ['connections', 'connections.date'],
  ['housekeeping', 'plugin.ai'], ['housekeeping', 'model.health'], ['housekeeping', 'model.fresh']];
const label = (id: string) => LABELS[id.startsWith('context:') ? `context.${id.slice(id.indexOf('.') + 1)}` : id] ?? id;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Runs every check of the spec. Never throws; resolves with the final list. */
export async function runCheckup({ owox: raw, hasAi, model, projectId, onUpdate }: CheckupArgs): Promise<Check[]> {
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
  const add = (id: string, group: GroupId, context?: Check['context']) => { map.set(id, { id, group, label: label(id), status: 'running', ...(context ? { context } : {}) }); };
  /** Settles a check; the fix shows only when it isn't passing. */
  const put = (id: string, status: CheckStatus, detail?: string, fix?: Fix | Fix[]) => {
    const c = map.get(id)!;
    const { detail: _d, fix: _f, ...rest } = c;
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
  for (const c of inputs.contexts) for (const k of ['description', 'marts', 'fact', 'plan', 'links']) add(`context:${c.id}.${k}`, 'drivers', { id: c.id, name: c.name });
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
    if (!critical) { skip('project.fact', 'project.critical'); skip('project.plan', 'project.critical'); }
    else {
      if (factOk) put('project.fact', 'ok', `${critical.metric} (${titles.get(goalId) ?? factLink.text})`);
      else put('project.fact', 'fail', "The Critical number's Fact doesn't link a Data Mart field", projectFix);
      if (critical.plan.some(isFieldLink)) put('project.plan', 'ok');
      else put('project.plan', 'warn', 'No plan: the goal shows without one', projectFix);
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
      if (c.description?.trim()) put(`${p}.description`, 'ok'); else put(`${p}.description`, 'warn', 'Empty description', fix);
      const n = inputs.marts.filter((m) => m.contexts.some((x) => x.id === c.id)).length;
      if (n) put(`${p}.marts`, 'ok', `${n} Data Marts`); else put(`${p}.marts`, 'warn', 'No Data Marts in this context', fix);
      if (rows.some((r) => r.fact.some(isFieldLink))) put(`${p}.fact`, 'ok'); else put(`${p}.fact`, 'warn', 'No metric row links a fact', fix);
      if (rows.some((r) => r.plan.some(isFieldLink))) put(`${p}.plan`, 'ok'); else put(`${p}.plan`, 'warn', 'No metric row links a plan', fix);
      await putLinks(`${p}.links`, rows, fix);
    })));
  });

  const connectionsGroup = () => guard('connections.', async () => {
    if (!factOk) { for (const id of ['reachable', 'any', 'facts', 'pk', 'date']) skip(`connections.${id}`, 'project.fact'); return; }
    const nodes: MartNode[] = [];
    await runPool(inputs.marts.map((m) => async () => {
      const d = await detail(m.id);
      const blendable = await fetchBlendable(owox, m.id);
      nodes.push({ id: m.id, title: m.title, contexts: m.contexts, detail: d, blendable });
    }), 6);
    const edges = buildEdges(nodes, visible, goalId);
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
    const dateText = `No date field, so not on the canvas: ${names(noDate)}`;
    if (noDate.length) put('connections.date', 'warn', dateText, martFixes(noDate));
    else put('connections.date', 'ok');
  });

  const modelGroup = () => guard('model.', async () => {
    if (!model) { for (const id of ['health', 'fresh']) put(`model.${id}`, 'skip', 'No model built yet'); return; }
    const fix: Fix = { kind: 'tab', label: 'Open Metrics', tab: 'ontology' };
    const { issues } = await checkHealth(owox, model, visible);
    if (issues.length) put('model.health', 'warn', plural(issues.length, 'broken reference', 'broken references'), fix); else put('model.health', 'ok');
    if (!inputs.contextsOk) { put('model.fresh', 'skip', "Contexts couldn't be read"); return; }
    const hash = await currentInputHash(owox, inputs, model.classes.map((c) => c.id), known);
    if (hash !== model.inputHash) put('model.fresh', 'warn', 'The descriptions changed since the model was built', fix); else put('model.fresh', 'ok');
  });

  await Promise.all([projectGroup(), goalGroup(), contextsGroup(), connectionsGroup(), modelGroup()]);
  return [...map.values()];
}
