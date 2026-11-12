import type { ProjectSettings, Edge, CoreClass } from '../types';
import { DATE_TYPES, flattenFields, type Inputs } from '../owox/sources';
import { hasDateField, hasPrimaryKey, type MartNode } from '../model/graph';
import { INDUSTRIES, inboundCounts, rankCore, singleKey } from '../model/core';
import { criticalRow, findMetricRows } from './tables';
import type { Option, Suggestion } from './types';

/** What a run loaded; code suggestions read it and never fetch. */
export interface SuggestContext { inputs: Inputs; nodes: MartNode[]; edges: Edge[]; goalId: string | null; settings: ProjectSettings; projectId: string }

export const MONEY = /revenue|sales|profit|gmv|amount|income/i;
export const PLAN = /plan|target|budget|goal/i;
const NUMBER_TYPE = /NUMERIC|FLOAT|INT|DECIMAL|DOUBLE/;
const MAX_FIELDS = 4;
const CONTEXTS_BY_INDUSTRY: Record<string, string[]> = {
  ecommerce: ['Marketing', 'Sales', 'Product'],
  saas: ['Marketing', 'Sales', 'Customer success'],
  marketplace: ['Supply', 'Demand', 'Marketing'],
  media: ['Content', 'Audience', 'Advertising'],
  b2b: ['Sales', 'Delivery', 'Marketing'],
  apps: ['Acquisition', 'Product', 'Monetization'],
  finance: ['Acquisition', 'Risk', 'Operations'],
  other: ['Marketing', 'Sales'],
};

export interface FieldPick { martId: string; title: string; field: string; label: string }

export const fieldLink = (projectId: string, martId: string, field: string, text: string) =>
  `[${text}](https://app.owox.com/ui/${projectId}/data-marts/${martId}/data-setup?field=${encodeURIComponent(field)})`;

const bySuffix = (checkId: string): string => (checkId.startsWith('context:') ? `context.${checkId.slice(checkId.indexOf('.') + 1)}` : checkId);
export const contextOf = (checkId: string): string | null => (checkId.startsWith('context:') ? checkId.slice(8, checkId.indexOf('.')) : null);

const hasDateType = (n: MartNode, types?: Set<string>) =>
  flattenFields(n.detail.fields).some((x) => { const t = x.field.type.toUpperCase(); return DATE_TYPES.has(t) && (!types || types.has(t)); });

/** SUM candidates: numeric money-like fields of Data Marts with a primary key and a date field, most referenced Data Mart first. */
export function moneyFields(nodes: MartNode[], edges: Edge[]): FieldPick[] {
  const inbound = inboundCounts(edges);
  return nodes
    .filter((n) => hasPrimaryKey(n.detail) && hasDateField(n.detail))
    .sort((a, b) => (inbound.get(b.id) ?? 0) - (inbound.get(a.id) ?? 0) || a.title.localeCompare(b.title))
    .flatMap((n) => flattenFields(n.detail.fields)
      .filter(({ field }) => NUMBER_TYPE.test(field.type.toUpperCase()) && (MONEY.test(field.name) || MONEY.test(field.alias ?? '')) && !PLAN.test(`${field.name} ${field.alias ?? ''}`))
      .map(({ path, field }) => ({ martId: n.id, title: n.title, field: path, label: `${field.alias || field.name} (${n.title})` })))
    .slice(0, MAX_FIELDS);
}

/** The metric's name: the field's alias or name. */
export const metricOf = (p: FieldPick): string => (p.label.split(' (')[0] ?? p.field).trim() || p.field;

const pickOptions = (picks: FieldPick[]): Option[] => picks.map((p, i) => ({ label: p.label, value: p, recommended: i === 0 }));

const criticalMetric = (ctx: SuggestContext): string => criticalRow(findMetricRows(ctx.inputs.projectDescription, 'project'))?.metric || 'the critical number';

function criticalNumber(ctx: SuggestContext): Suggestion | null {
  const picks = moneyFields(ctx.nodes, ctx.edges);
  if (!picks.length) return null;
  return {
    question: 'Which number tells you the business is on track?',
    options: pickOptions(picks),
    ai: false,
    target: (o) => {
      const p = o.value as FieldPick;
      return { kind: 'critical_fact', scope: 'project', metric: metricOf(p), factLink: fieldLink(ctx.projectId, p.martId, p.field, metricOf(p)) };
    },
  };
}

function plan(ctx: SuggestContext): Suggestion | null {
  const metric = criticalMetric(ctx);
  const goal = ctx.nodes.find((n) => n.id === ctx.goalId);
  const types = goal ? new Set(flattenFields(goal.detail.fields).map((x) => x.field.type.toUpperCase()).filter((t) => DATE_TYPES.has(t))) : undefined;
  const picks = ctx.nodes
    .filter((n) => n.id !== ctx.goalId && hasDateType(n, types?.size ? types : undefined))
    .flatMap((n) => flattenFields(n.detail.fields)
      .filter(({ field }) => NUMBER_TYPE.test(field.type.toUpperCase()) && (PLAN.test(field.name) || PLAN.test(field.alias ?? '')))
      .map(({ path, field }) => ({ martId: n.id, title: n.title, field: path, label: `${field.alias || field.name} (${n.title})` })))
    .slice(0, 3);
  if (!picks.length) return null;
  return {
    question: `Where is the plan for ${metric}?`,
    options: pickOptions(picks),
    ai: false,
    target: (o) => {
      const p = o.value as FieldPick;
      return { kind: 'critical_plan', scope: 'project', planLink: fieldLink(ctx.projectId, p.martId, p.field, `Plan · ${metric}`) };
    },
  };
}

export const industryOf = (ctx: SuggestContext) => INDUSTRIES.find((i) => i.id === (ctx.settings.industry ?? 'other')) ?? INDUSTRIES[INDUSTRIES.length - 1]!;
const asCore = (ids: string[]): CoreClass[] => ids.map((martId) => ({ martId, why: '' }));
export const titleOf = (ctx: SuggestContext, id: string) => ctx.nodes.find((n) => n.id === id)?.title ?? id;
export const ranked = (ctx: SuggestContext): string[] => ctx.goalId
  ? rankCore({ goalId: ctx.goalId, nodes: ctx.nodes.map((n) => ({ id: n.id, title: n.title, singleKey: singleKey(n.detail) })), edges: ctx.edges })
  : [];

function coreSet(ctx: SuggestContext): Suggestion | null {
  const rank = ranked(ctx);
  if (!rank.length) return null;
  const want = industryOf(ctx).count;
  const sizes = [...new Set([want, want + 1, want - 1, 3].map((n) => Math.min(Math.max(n, 3), 7, rank.length)))].slice(0, 4);
  return {
    question: 'Which Data Marts are the core classes of the business?',
    options: sizes.map((n, i) => ({ label: rank.slice(0, n).map((id) => titleOf(ctx, id)).join(', '), value: asCore(rank.slice(0, n)), recommended: i === 0 })),
    ai: false,
    target: (o) => ({ kind: 'settings', patch: { coreClasses: o.value as CoreClass[] } }),
  };
}

function coreMissing(ctx: SuggestContext): Suggestion | null {
  const current = ctx.settings.coreClasses ?? asCore(ranked(ctx).slice(0, industryOf(ctx).count));
  const inbound = inboundCounts(ctx.edges);
  const have = new Set(current.map((c) => c.martId));
  const more = ctx.nodes
    .filter((n) => n.id !== ctx.goalId && !have.has(n.id) && singleKey(n.detail) && (inbound.get(n.id) ?? 0) >= 3)
    .sort((a, b) => (inbound.get(b.id) ?? 0) - (inbound.get(a.id) ?? 0) || a.title.localeCompare(b.title))
    .slice(0, 4);
  if (!more.length || current.length >= 7) return null;
  return {
    question: `Add ${more[0]!.title} as a core class? ${inbound.get(more[0]!.id)} Data Marts reference it.`,
    options: more.map((n, i) => ({ label: `${n.title} (${inbound.get(n.id)} inbound)`, value: n.id, recommended: i === 0 })),
    ai: false,
    target: (o) => ({ kind: 'settings', patch: { coreClasses: [...current, { martId: o.value as string, why: '' }] } }),
  };
}

function contextsExist(ctx: SuggestContext): Suggestion | null {
  const have = new Set(ctx.inputs.contexts.map((c) => c.name.trim().toLowerCase()));
  const names = (CONTEXTS_BY_INDUSTRY[ctx.settings.industry ?? 'other'] ?? CONTEXTS_BY_INDUSTRY.other!).filter((n) => !have.has(n.toLowerCase()));
  if (!names.length) return null;
  return {
    question: `Which teams move ${criticalMetric(ctx)}?`,
    options: names.map((n, i) => ({ label: n, value: n, recommended: i === 0 })),
    ai: false,
    target: (o) => ({ kind: 'context_create', name: o.value as string, description: '' }),
  };
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3));

function contextMarts(ctx: SuggestContext, id: string): Suggestion | null {
  const c = ctx.inputs.contexts.find((x) => x.id === id);
  if (!c) return null;
  const cw = words(c.name);
  const titleIn = (martId: string) => ctx.inputs.marts.find((m) => m.id === martId)?.title ?? martId;
  const marts = ctx.inputs.marts.filter((m) => !m.contexts.some((x) => x.id === id) && [...words(m.title)].some((w) => cw.has(w))).slice(0, 4);
  if (!marts.length) return null;
  return {
    question: `Which Data Marts belong to ${c.name}?`,
    options: marts.map((m, i) => ({ label: m.title, value: m.id, recommended: i === 0 })),
    ai: false,
    target: (o) => ({ kind: 'mart_add_context', martId: o.value as string, contextId: id, martTitle: titleIn(o.value as string), contextName: c.name }),
  };
}

/** A recommended answer decided by code, or null when the check has none or the data to decide it is missing. */
export function codeSuggestion(checkId: string, ctx: SuggestContext): Suggestion | null {
  switch (bySuffix(checkId)) {
    case 'project.fact': case 'project.critical': case 'project.table': return criticalNumber(ctx);
    case 'project.plan': return plan(ctx);
    case 'core.set': case 'core.count': return coreSet(ctx);
    case 'core.missing': return coreMissing(ctx);
    case 'contexts.exist': return contextsExist(ctx);
    case 'model.built': return { question: 'Build the model?', options: [{ label: 'Build the model', value: 'build', recommended: true }], ai: false, target: () => ({ kind: 'model', action: 'build' }) };
    case 'model.fresh': return { question: 'Bring the model up to date?', options: [{ label: 'Rebuild and review the changes', value: 'rebuild', recommended: true }], ai: false, target: () => ({ kind: 'model', action: 'rebuild' }) };
    case 'context.marts': return contextMarts(ctx, contextOf(checkId)!);
    default: return null;
  }
}
