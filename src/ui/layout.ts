import type { ClassNode, ContextRef, Model } from '../types';

export interface Connector { from: string; to: string; dashed: boolean }
export interface Layout { rows: ClassNode[][]; connectors: Connector[] }

/** selected empty means All. */
export function layoutFor(model: Model, selected: ReadonlySet<string>): Layout {
  const visible = model.classes.filter(
    (c) => selected.size === 0 || c.id === model.goal.classId || c.contexts.some((x) => selected.has(x.id)),
  );
  const visibleIds = new Set(visible.map((c) => c.id));

  const depths = [...new Set(visible.map((c) => c.depth))].sort((a, b) => a - b);
  const rows = depths.map((d) => visible.filter((c) => c.depth === d).sort((a, b) => a.title.localeCompare(b.title)));

  const next = new Map<string, string[]>();
  for (const e of model.edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);

  const found = new Map<string, Connector>();
  const add = (from: string, to: string, dashed: boolean) => {
    const key = `${from}\u0000${to}`;
    const prev = found.get(key);
    if (!prev || (prev.dashed && !dashed)) found.set(key, { from, to, dashed });
  };

  for (const u of visible) {
    const seen = new Set<string>([u.id]);
    const walk = (id: string, viaHidden: boolean) => {
      for (const to of next.get(id) ?? []) {
        if (visibleIds.has(to)) {
          if (to !== u.id) add(u.id, to, viaHidden);
        } else if (!seen.has(to)) {
          seen.add(to);
          walk(to, true);
        }
      }
    };
    walk(u.id, false);
  }

  const rowOf = new Map<string, number>();
  rows.forEach((row, i) => row.forEach((c) => rowOf.set(c.id, i)));
  // Only downward links: same-row and upward edges would cross cards.
  const connectors = [...found.values()]
    .filter((c) => (rowOf.get(c.to) ?? 0) > (rowOf.get(c.from) ?? 0)).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { rows, connectors };
}

export function contextsOf(model: Model): ContextRef[] {
  const byId = new Map<string, ContextRef>();
  for (const c of model.classes) for (const x of c.contexts) if (!byId.has(x.id)) byId.set(x.id, x);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
