import type { Blocked, Measure, MetricDef } from '../types';
import type { MartLink } from '../lib/links';
import { DATE_TYPES, flattenFields } from '../owox/sources';
import type { Blendable, MartDetail, SchemaField } from '../owox/sources';
import { hasPrimaryKey } from './graph';
import type { AiMetric, AiOutput } from './interpret';
import { allowsAggregation, fieldAt } from './aggregations';
import { fieldLabel } from './metricName';

export interface ValidateInput { ai: AiOutput; links: MartLink[]; details: Map<string, MartDetail>; visible: ReadonlySet<string> }
export type ValidateResult =
  | { ok: true; goal: { martId: string; field: string; metricId: string }; metrics: MetricDef[] }
  | { ok: false; blocked: Blocked };

const pathsOf = (d: MartDetail) => new Map(flattenFields(d.fields).map((x) => [x.path, x.field]));
const isDateField = (f: SchemaField | undefined) => !!f && DATE_TYPES.has(f.type.toUpperCase());
export const metricId = (martId: string, m: Measure) => `${martId}:${m.field}:${m.fn ?? 'calc'}`;

const blocked = (code: Blocked['code'], detail: string, mismatches: string[] = []): ValidateResult => ({ ok: false, blocked: { code, detail, mismatches } });

const SUPPORTED = new Set<string>(['SUM', 'COUNT', 'COUNT_DISTINCT', 'AVG', 'MIN', 'MAX']);

/** null when the field allows only aggregations Gyroscope can't query. */
function measureFor(field: SchemaField, field_: string, agg: AiMetric['aggregation']): Measure | null {
  if (field.calculated && field.calculated.level !== 'column') return { field: field_, fn: null };
  const allowed = field.allowedAggregations;
  if (agg) return { field: field_, fn: agg };
  if (!allowed || !allowed.length || allowed.includes('SUM')) return { field: field_, fn: 'SUM' };
  const fn = allowed.find((a) => SUPPORTED.has(a));
  return fn ? { field: field_, fn: fn as Measure['fn'] } : null;
}

export function validate(input: ValidateInput): ValidateResult {
  const { ai, links, details, visible } = input;
  if (ai.goal.status === 'missing') return blocked('NO_GOAL', 'The project description has no Critical number in its metrics table.');

  const goalMetric = ai.metrics.find((m) => m.ref === ai.goal.metricRef);
  const goalLink = goalMetric && goalMetric.factLink !== null ? links[goalMetric.factLink] : undefined;
  if (ai.goal.status === 'placeholder' || !goalMetric || !goalLink || goalLink.placeholder || !goalLink.martId || !goalLink.field) {
    const detail = goalLink ? `The Critical number links to "${goalLink.text}" (${goalLink.url}), which is not a Data Mart field.` : 'The Critical number has no link to a Data Mart field.';
    return blocked('GOAL_PLACEHOLDER', detail);
  }

  const goalMart = goalLink.martId;
  const goalField = goalLink.field;
  const goalDetail = details.get(goalMart);
  if (visible.has(goalMart) && goalDetail) {
    if (!pathsOf(goalDetail).has(goalField)) return blocked('GOAL_FIELD_NOT_FOUND', `${goalField} is not a field of ${goalDetail.title}.`);
    if (!hasPrimaryKey(goalDetail)) return blocked('GOAL_NO_PRIMARY_KEY', `${goalDetail.title} has no primary key, so it cannot be a class.`);
  }

  const mismatches: string[] = [];
  const metrics: MetricDef[] = [];
  let goalId = metricId(goalMart, { field: goalField, fn: goalMetric.aggregation ?? 'SUM' });

  const check = (alias: string, link: MartLink, dateField: string | null, agg: AiMetric['aggregation'], label: string): { detail: MartDetail; field: SchemaField } | null => {
    const detail = details.get(link.martId!);
    if (!detail) return null;
    const lab = label ? `${label} ` : '';
    const paths = pathsOf(detail);
    const field = link.field ? paths.get(link.field) : undefined;
    if (!field) { mismatches.push(`${alias} → ${lab}field "${link.field}" not found in ${detail.title}`); return null; }
    let ok = true;
    if (dateField !== null && !isDateField(paths.get(dateField))) { mismatches.push(`${alias} → ${lab}date field "${dateField}" is not a date field of ${detail.title}`); ok = false; }
    if (agg && !field.calculated && field.allowedAggregations && !field.allowedAggregations.includes(agg)) { mismatches.push(`${alias} → aggregation ${agg} is not allowed for "${link.field}" in ${detail.title}`); ok = false; }
    return ok ? { detail, field } : null;
  };

  for (const m of ai.metrics) {
    const link = m.factLink !== null ? links[m.factLink] : undefined;
    if (!link || link.placeholder || !link.martId || !link.field || !visible.has(link.martId)) continue;
    const hit = check(m.alias, link, m.factDateField, m.aggregation, '');
    if (!hit) continue;
    const measure = measureFor(hit.field, link.field, m.aggregation);
    if (!measure) { mismatches.push(`${m.alias} → no supported aggregation for ${link.field}`); continue; }

    let plan: MetricDef['plan'] = null;
    const pl = m.planLink !== null ? links[m.planLink] : undefined;
    if (pl && !pl.placeholder && pl.martId && pl.field && visible.has(pl.martId)) {
      const ph = check(m.alias, pl, m.planDateField, null, 'plan');
      if (ph && !m.planDateField) mismatches.push(`${m.alias} → plan date field missing for ${ph.detail.title}`);
      const planMeasure = ph ? measureFor(ph.field, pl.field, null) : null;
      if (ph && !planMeasure) mismatches.push(`${m.alias} → no supported aggregation for ${pl.field}`);
      if (ph && planMeasure && m.planDateField) plan = { martId: pl.martId, measure: planMeasure, dateField: m.planDateField, shape: m.planShape ?? 'daily' };
    }

    const m_: MetricDef = {
      id: metricId(link.martId, measure), martId: link.martId, alias: fieldLabel(hit.field.alias, link.field), measure, kind: measure.fn === null ? 'flow' : m.kind,
      dateField: m.factDateField, role: m.role, source: m.source, isUniqueCount: false, plan, shown: true, forecast: null,
      calculated: !!hit.field.calculated, format: m.format, currency: m.format === 'currency' ? m.currency : null,
      description: hit.field.description?.trim() || null,
    };
    metrics.push(m_);
    if (m === goalMetric) goalId = m_.id;
  }

  if (mismatches.length) return blocked('AI_INVALID', "The AI's reading of the descriptions doesn't match the Data Mart schemas.", mismatches);
  return { ok: true, goal: { martId: goalMart, field: goalField, metricId: goalId }, metrics };
}

export function uniqueCountMetric(detail: MartDetail, blendable: Blendable): MetricDef | null {
  if (blendable.mainUniqueCountKeyFields.length !== 1) return null;
  const key = blendable.mainUniqueCountKeyFields[0]!;
  const flat = flattenFields(detail.fields);
  // a number key can't be COUNT_DISTINCTed through the data endpoint until OWOX/owox-data-marts#1829 lands
  const keyField = fieldAt(detail, key);
  if (!keyField || !allowsAggregation(keyField, 'COUNT_DISTINCT')) return null;
  const dates = flat.filter((x) => isDateField(x.field));
  const dateField = (dates.find((x) => x.field.isPrimaryKey) ?? dates.find((x) => /creat|date|time/i.test(x.field.name)) ?? dates[0])?.path ?? null;
  const measure: Measure = { field: key, fn: 'COUNT_DISTINCT' };
  return { id: metricId(detail.id, measure), martId: detail.id, alias: detail.title, measure, kind: 'flow', role: 'unique', source: 'schema', isUniqueCount: true, calculated: false, format: 'number', currency: null, plan: null, shown: true, forecast: null, dateField };
}
