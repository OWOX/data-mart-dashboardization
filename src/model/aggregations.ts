import type { MetricDef } from '../types';
import { DATE_TYPES } from '../owox/sources';
import type { MartDetail, SchemaField } from '../owox/sources';

// OWOX governance defaults per type family (owox-data-marts field-aggregation-governance.ts)
const NUMBER = /^(U?(TINY|SMALL|MEDIUM|BIG)?INT(EGER)?\d*|FLOAT\d*|DOUBLE.*|REAL|NUMERIC|BIGNUMERIC|DECIMAL|BIGDECIMAL|DEC|NUMBER)$/;
const STRING = /^(STRING|VARCHAR\d*|CHAR\d*|TEXT|NVARCHAR\d*)$/;
const DEFAULTS = { number: ['SUM', 'AVG', 'MIN', 'MAX'], string: ['COUNT', 'COUNT_DISTINCT'], boolean: ['COUNT', 'COUNT_DISTINCT'], date: ['MIN', 'MAX'] };

function defaultsFor(type: string): string[] {
  const t = type.toUpperCase().replace(/\(.*\)/, '').trim();
  if (NUMBER.test(t)) return DEFAULTS.number;
  if (STRING.test(t)) return DEFAULTS.string;
  if (t === 'BOOLEAN' || t === 'BOOL') return DEFAULTS.boolean;
  if (DATE_TYPES.has(t) || t === 'TIME') return DEFAULTS.date;
  return [];
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

/** True only when the live schema is known, holds the field, and the field refuses the metric's aggregation. */
export function uncomputable(metric: MetricDef, detail: MartDetail | undefined): boolean {
  const field = detail ? fieldAt(detail, metric.measure.field) : undefined;
  return !!field && !allowsAggregation(field, metric.measure.fn);
}
