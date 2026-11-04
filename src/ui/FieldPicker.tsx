import { useId } from 'react';
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

/** Fields a forecast can be fed from: not dates, not records. */
export const valueFields = (infos: FieldInfo[]): FieldInfo[] =>
  infos.filter((x) => !DATE_TYPES.has(x.field.type.toUpperCase()) && !['RECORD', 'STRUCT'].includes(x.field.type.toUpperCase()));

export interface Option { value: string; label: string }

/** Fields as choices: the alias when there is one, else the path; an alias shared by several fields gets the path added. */
export function fieldOptions(infos: FieldInfo[]): Option[] {
  const label = (x: FieldInfo) => x.field.alias?.trim() || x.path;
  const seen = new Map<string, number>();
  for (const x of infos) seen.set(label(x), (seen.get(label(x)) ?? 0) + 1);
  return infos.map((x) => {
    const l = label(x);
    return { value: x.path, label: (seen.get(l) ?? 0) > 1 && l !== x.path ? `${l} (${x.path})` : l };
  });
}

/**
 * A select whose current value may no longer exist: the old value stays as a disabled "(missing)" option and the
 * select turns red. While the schema is still loading the value is kept as it is, unflagged.
 */
export function FieldPicker({ label, value, options, none, unverified = false, note, onChange }: {
  label: string; value: string; options: Option[]; none?: Option; onChange: (v: string) => void;
  /** The schema or the access list isn't known (loading, unreadable, not checked): nothing is flagged. */
  unverified?: boolean;
  /** Shown beside the select, e.g. why it couldn't be verified. */
  note?: string;
}) {
  const hint = useId();
  const known = options.some((o) => o.value === value);
  const empty = value === '' || (none !== undefined && value === none.value);
  const missing = !unverified && !known && !empty;
  const text = missing ? `${value} no longer exists` : note;
  return (
    <>
      <select
        className={`gy-select gy-onto-pick${missing ? ' gy-bad' : ''}`} aria-label={label} aria-invalid={missing || undefined}
        aria-describedby={text ? hint : undefined} title={text}
        value={value} onChange={(e) => onChange(e.target.value)}
      >
        {none ? <option value={none.value}>{none.label}</option> : value === '' && <option value="" disabled>Select…</option>}
        {!known && !empty && (unverified ? <option value={value}>{value}</option> : <option value={value} disabled>{value} (missing)</option>)}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {text && <span id={hint} className={missing ? 'gy-sr' : 'gy-bad-text'}>{text}</span>}
    </>
  );
}
