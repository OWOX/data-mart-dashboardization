import type { ClassNode, ContextRef, Model } from '../types';

/**
 * A line between two cards. `from` references `to` in a formula, so data flows from `to` into
 * `from`. `join` is a link between two drivers: both ends sit in the same band. `fields` are the
 * calculated fields of `from` the line stands for; a dashed line crosses hidden marts and has none.
 */
export interface Connector { from: string; to: string; dashed: boolean; join: boolean; fields: string[] }
/** Two bands only: the main class alone on top, every other class below it. */
export interface Layout { main: ClassNode | null; drivers: ClassNode[]; connectors: Connector[] }

/** selected empty means All. */
export function layoutFor(model: Model, selected: ReadonlySet<string>): Layout {
  const mainId = model.goal.classId;
  const visible = model.classes.filter(
    (c) => selected.size === 0 || c.id === mainId || c.contexts.some((x) => selected.has(x.id)),
  );
  const visibleIds = new Set(visible.map((c) => c.id));
  const main = visible.find((c) => c.id === mainId) ?? null;
  // Closest to the goal first, so the drivers that feed it directly sit nearest the middle of the read.
  const drivers = visible
    .filter((c) => c.id !== mainId)
    .sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title));

  const next = new Map<string, string[]>();
  const fieldsOf = new Map<string, string[]>();
  for (const e of model.edges) {
    next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
    fieldsOf.set(`${e.from}\u0000${e.to}`, e.fields ?? []);
  }

  const found = new Map<string, Connector>();
  const add = (from: string, to: string, dashed: boolean) => {
    // A pair linked both ways is one line: the first direction found keeps it.
    const key = from < to ? `${from}\u0000${to}` : `${to}\u0000${from}`;
    const prev = found.get(key);
    const join = from !== mainId && to !== mainId;
    const fields = dashed ? [] : fieldsOf.get(`${from}\u0000${to}`) ?? [];
    if (!prev || (prev.dashed && !dashed)) found.set(key, { from, to, dashed, join, fields });
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

  const connectors = [...found.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { main, drivers, connectors };
}

export function contextsOf(model: Model): ContextRef[] {
  const byId = new Map<string, ContextRef>();
  for (const c of model.classes) for (const x of c.contexts) if (!byId.has(x.id)) byId.set(x.id, x);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
