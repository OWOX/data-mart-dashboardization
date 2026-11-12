import type { CollectionsLike } from '../store/collections';
import { saveProjectSettings } from '../store/collections';
import { contextPath, martPath, type OwoxLike } from '../owox/sources';
import type { ProjectSettings } from '../types';
import { describeError, statusesOf } from '../lib/errors';
import { setCriticalFact, setCriticalPlan } from './tables';
import type { ApplyTarget, Scope } from './types';

export type ApplyResult = { ok: true } | { ok: false; refused: true; snippet: string } | { ok: false; refused: false; error: string };

export interface ApplyDeps { owox: OwoxLike; store: CollectionsLike; settings: ProjectSettings; onModel: (action: 'build' | 'rebuild') => void }

/** Thrown when OWOX can't take the write from this client; Apply turns it into the copy-ready snippet. */
class Unavailable extends Error {}

/** The text a person would paste by hand when a write is refused. */
function snippetOf(t: ApplyTarget): string {
  switch (t.kind) {
    case 'description_append': return t.text;
    case 'critical_fact': return setCriticalFact(null, t.metric, t.factLink);
    case 'critical_plan': return t.planLink;
    case 'context_create': return t.description || t.name;
    case 'mart_add_context': return `Add ${t.martTitle} to the context ${t.contextName}`;
    case 'settings': return JSON.stringify(t.patch);
    case 'model': return t.action;
  }
}

const refusedBy = (e: unknown) => statusesOf(e).some((s) => s === 401 || s === 403);

async function write(t: ApplyTarget, { owox, store, onModel }: ApplyDeps): Promise<void> {
  const put = (path: string, body: unknown) => { if (!owox.putJson) throw new Unavailable(); return owox.putJson(path, body); };
  // reads the description now and writes `change(current)` back; the context keeps its current name
  const edit = async (scope: Scope, change: (current: string | null) => string | null) => {
    if (scope === 'project') {
      const next = change((await owox.project.getSettings()).description);
      if (next === null) return;
      if (owox.project.updateDescription) await owox.project.updateDescription(next);
      else await put('/api/projects/settings/description', { description: next });
      return;
    }
    const c = (await owox.getJson<{ id: string; name: string; description?: unknown }[]>('/api/contexts')).find((x) => x.id === scope.contextId);
    if (!c) throw new Error('The context no longer exists');
    const next = change(typeof c.description === 'string' ? c.description : null);
    if (next !== null) await put(contextPath(c.id), { name: c.name, description: next });
  };
  switch (t.kind) {
    case 'settings':
      if (Object.keys(t.patch).length) await saveProjectSettings(store, t.patch);
      return;
    case 'description_append': await edit(t.scope, (cur) => (cur?.trim() ? `${cur}\n\n${t.text}` : t.text)); return;
    case 'critical_fact': await edit(t.scope, (cur) => setCriticalFact(cur, t.metric, t.factLink)); return;
    case 'critical_plan':
      await edit(t.scope, (cur) => {
        const next = setCriticalPlan(cur, t.planLink);
        if (next === null) throw new Error('Add the critical number first');
        return next;
      });
      return;
    case 'context_create':
      if (!owox.postJson) throw new Unavailable();
      await owox.postJson('/api/contexts', { name: t.name, description: t.description });
      return;
    case 'mart_add_context': {
      const dm = await owox.getJson<{ contexts?: { id: string }[] }>(martPath(t.martId));
      // without a contexts list on the detail, the summary has it; never write a list built from nothing
      const current = Array.isArray(dm.contexts) ? dm.contexts : (await owox.dataMarts.list()).find((m) => m.id === t.martId)?.contexts;
      if (!current) throw new Error("Couldn't read the Data Mart's contexts");
      const ids = current.map((c) => c.id);
      if (!ids.includes(t.contextId)) ids.push(t.contextId);
      await put(martPath(t.martId, '/contexts'), { contextIds: ids });
      return;
    }
    case 'model': onModel(t.action); return;
  }
}

/** Writes one answer from the current state, not the state the run saw. A 401 or 403, or a client that can't write, returns the snippet; any other failure returns its message. */
export async function applyTarget(t: ApplyTarget, deps: ApplyDeps): Promise<ApplyResult> {
  try {
    await write(t, deps);
    return { ok: true };
  } catch (e) {
    if (e instanceof Unavailable || refusedBy(e)) return { ok: false, refused: true, snippet: snippetOf(t) };
    return { ok: false, refused: false, error: describeError(e) };
  }
}
