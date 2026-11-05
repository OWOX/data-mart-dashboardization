import type { MetricDef } from '../types';
import { DATE_TYPES } from '../owox/sources';
import type { MartDetail, SchemaField } from '../owox/sources';

// OWOX type categories and default aggregations (owox-data-marts field-type-category.ts, field-aggregation-governance.ts)
const NUMBER = new Set(['INTEGER', 'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'FLOAT', 'REAL', 'DOUBLE', 'DOUBLE PRECISION', 'NUMERIC', 'BIGNUMERIC', 'DECIMAL']);
const STRING = new Set(['STRING', 'VARCHAR', 'CHAR', 'TEXT', 'BPCHAR']);
const DATE = new Set([...DATE_TYPES, 'TIMESTAMP WITH TIME ZONE', 'TIMESTAMPTZ']);
const TIME = new Set(['TIME', 'TIME WITH TIME ZONE', 'TIMETZ']);
const BOOL = new Set(['BOOLEAN', 'BOOL']);

function defaultsFor(type: string): string[] {
  const t = type.trim().toUpperCase();
  if (NUMBER.has(t)) return ['SUM', 'AVG', 'MIN', 'MAX'];
  if (STRING.has(t)) return ['COUNT', 'COUNT_DISTINCT', 'STRING_AGG', 'ANY_VALUE'];
  if (DATE.has(t) || TIME.has(t)) return ['MIN', 'MAX'];
  if (BOOL.has(t)) return ['COUNT', 'COUNT_DISTINCT'];
  return ['COUNT'];
}

/** Whether OWOX can aggregate `field` with `fn`; a metric-level calculated field takes `fn: null` only. */
export function allowsAggregation(field: SchemaField, fn: string | null): boolean {
  const calculated = !!field.calculated && field.calculated.level !== 'column';
  if (fn === null) return calculated;
  const allowed = field.allowedAggregations ?? defaultsFor(field.type);
  return allowed.includes(fn);
}

function find(fields: SchemaField[], path: string, prefix = ''): SchemaField | undefined {
  for (const f of fields) {
    if (f.status === 'DISCONNECTED') continue;
    const p = prefix ? `${prefix}.${f.name}` : f.name;
    if (p === path) return f;
    if (f.mode !== 'REPEATED' && path.startsWith(`${p}.`)) { const hit = find(f.fields ?? [], path, p); if (hit) return hit; }
  }
  return undefined;
}

export const fieldAt = (detail: MartDetail, path: string): SchemaField | undefined => find(detail.fields, path);

/** True only when the live schema is known, holds the field, and the field refuses the metric's aggregation. A unique count never asks the field to aggregate. */
export function uncomputable(metric: MetricDef, detail: MartDetail | undefined): boolean {
  if (metric.isUniqueCount) return false;
  const field = detail ? fieldAt(detail, metric.measure.field) : undefined;
  return !!field && !allowsAggregation(field, metric.measure.fn);
}
