import type { Edge } from '../types';
import { parseRefs } from '../lib/refs';
import { DATE_TYPES, flattenFields, type Blendable, type MartDetail, type SchemaField } from '../owox/sources';

export interface MartNode {
  id: string; title: string;
  contexts: { id: string; name: string }[];
  detail: MartDetail;
  blendable: Blendable;
}
export interface RefEdge extends Edge { refFields: string[]; fields: string[] }

/** Every primary key path, hidden ones too: a unique-count key is often hidden for reporting. */
export function primaryKeyPaths(fields: SchemaField[], prefix = ''): string[] {
  return fields.flatMap((f) => {
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    return [...(f.isPrimaryKey ? [path] : []), ...primaryKeyPaths(f.fields ?? [], path)];
  });
}

export const hasPrimaryKey = (detail: MartDetail): boolean => primaryKeyPaths(detail.fields).length > 0;

/** A reportable date field, as the metrics see one: hidden and disconnected fields don't count. */
export const hasDateField = (detail: MartDetail): boolean => flattenFields(detail.fields).some((x) => DATE_TYPES.has(x.field.type.toUpperCase()));

function resolveTarget(path: string, b: Blendable, visible: ReadonlySet<string>, allowHiddenTarget?: string): string | null {
  const segs = path.split('.');
  let target: string | null = null;
  for (let i = 1; i <= segs.length; i++) {
    const prefix = segs.slice(0, i).join('.');
    const s = b.availableSources.find((x) => x.aliasPath === prefix);
    if (!s || !s.isAccessibleForReporting) return null;
    const last = i === segs.length;
    if (!visible.has(s.dataMartId) && !(last && s.dataMartId === allowHiddenTarget)) return null;
    target = s.dataMartId;
  }
  return target;
}

export function buildEdges(nodes: MartNode[], visible: ReadonlySet<string>, allowHiddenTarget?: string): RefEdge[] {
  const byKey = new Map<string, RefEdge>();
  for (const n of nodes) {
    for (const f of n.detail.fields) {
      if (!f.calculated) continue;
      for (const ref of parseRefs(f.calculated.formula)) {
        if (!ref.path) continue;
        const to = resolveTarget(ref.path, n.blendable, visible, allowHiddenTarget);
        if (!to || to === n.id) continue;
        const key = `${n.id}\u0000${to}`;
        const e = byKey.get(key) ?? { from: n.id, to, refFields: [], fields: [] };
        if (!e.refFields.includes(ref.field)) e.refFields.push(ref.field);
        if (!e.fields.includes(f.name)) e.fields.push(f.name);
        byKey.set(key, e);
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/** Depths from the main class, walking only through Data Marts that can be classes; the main class is always in. */
export function classDepths(mainId: string, edges: Edge[], classable: ReadonlySet<string>): Map<string, number> {
  const depth = new Map([[mainId, 0]]);
  const queue = [mainId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of edges) {
      if (e.from !== cur || depth.has(e.to) || !classable.has(e.to)) continue;
      depth.set(e.to, depth.get(cur)! + 1);
      queue.push(e.to);
    }
  }
  return depth;
}
