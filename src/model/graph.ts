import type { Edge } from '../types';
import { parseRefs } from '../lib/refs';
import type { Blendable, MartDetail, SchemaField } from '../owox/sources';

export interface MartNode {
  id: string; title: string;
  contexts: { id: string; name: string }[];
  detail: MartDetail;
  blendable: Blendable;
}
export interface RefEdge extends Edge { refFields: string[]; fields: string[] }

export function hasPrimaryKey(detail: MartDetail): boolean {
  const walk = (fs: SchemaField[]): boolean => fs.some((f) => f.isPrimaryKey || walk(f.fields ?? []));
  return walk(detail.fields);
}

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

export function chooseMain(args: { goalMartId: string; goalField: string; nodes: MartNode[]; visible: ReadonlySet<string> }): { id: string; viaFallback: boolean } | null {
  const { goalMartId, goalField, nodes, visible } = args;
  if (visible.has(goalMartId)) return { id: goalMartId, viaFallback: false };
  // A mart two steps away needs a visible mart one step away, so only direct referrers can win.
  const toGoal = buildEdges(nodes, visible, goalMartId).filter((e) => e.to === goalMartId);
  if (!toGoal.length) return null;
  const title = new Map(nodes.map((n) => [n.id, n.title]));
  toGoal.sort((a, b) =>
    Number(b.refFields.includes(goalField)) - Number(a.refFields.includes(goalField)) ||
    (title.get(a.from) ?? a.from).localeCompare(title.get(b.from) ?? b.from));
  return { id: toGoal[0]!.from, viaFallback: true };
}

export function classDepths(mainId: string, edges: Edge[], withPk: ReadonlySet<string>): Map<string, number> {
  const depth = new Map([[mainId, 0]]);
  const queue = [mainId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of edges) {
      if (e.from !== cur || depth.has(e.to) || !withPk.has(e.to)) continue;
      depth.set(e.to, depth.get(cur)! + 1);
      queue.push(e.to);
    }
  }
  return depth;
}
