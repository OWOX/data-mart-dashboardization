import { DATE_TYPES, type SchemaField } from '../owox/sources';
import type { AggFn } from '../types';

export const AGGS: AggFn[] = ['SUM', 'COUNT', 'COUNT_DISTINCT', 'AVG', 'MIN', 'MAX'];

export interface FieldInfo { path: string; field: SchemaField }

/** Every field of a mart that can still be queried: hidden-for-reporting ones count, DISCONNECTED ones don't. */
export function martFields(fields: SchemaField[], prefix = ''): FieldInfo[] {
  return fields.flatMap((f) => {
    if (f.status === 'DISCONNECTED') return [];
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    return [{ path, field: f }, ...(f.mode === 'REPEATED' ? [] : martFields(f.fields ?? [], path))];
  });
}

export const dateFields = (infos: FieldInfo[]): FieldInfo[] => infos.filter((x) => DATE_TYPES.has(x.field.type.toUpperCase()));

export interface Option { value: string; label: string }

/**
 * A select whose current value may no longer exist: the old value stays as a disabled "(missing)" option and the
 * select turns red. While the schema is still loading the value is kept as it is, unflagged.
 */
export function FieldPicker({ label, value, options, none, loading = false, onChange }: {
  label: string; value: string; options: Option[]; none?: Option; loading?: boolean; onChange: (v: string) => void;
}) {
  const known = options.some((o) => o.value === value);
  const empty = value === '' || (none !== undefined && value === none.value);
  const missing = !loading && !known && !empty;
  return (
    <select
      className={`gy-select gy-onto-pick${missing ? ' gy-bad' : ''}`} aria-label={label} aria-invalid={missing || undefined}
      title={missing ? `${value} no longer exists` : undefined}
      value={value} onChange={(e) => onChange(e.target.value)}
    >
      {none ? <option value={none.value}>{none.label}</option> : value === '' && <option value="" disabled>Select…</option>}
      {!known && !empty && (loading ? <option value={value}>{value}</option> : <option value={value} disabled>{value} (missing)</option>)}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
