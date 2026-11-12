import type { CollectionsLike } from '../store/collections';
import { saveProjectSettings } from '../store/collections';
import type { OwoxLike } from '../owox/sources';
import type { ProjectSettings } from '../types';
import { describeError, statusesOf } from '../lib/errors';
import { upsertMetricsTable } from './tables';
import type { ApplyTarget } from './types';

export type ApplyResult = { ok: true } | { ok: false; refused: true; snippet: string } | { ok: false; refused: false; error: string };

export interface ApplyDeps { owox: OwoxLike; store: CollectionsLike; settings: ProjectSettings; onModel: (action: 'build' | 'rebuild') => void }

/** Thrown when OWOX can't take the write from this client; Apply turns it into the copy-ready snippet. */
class Unavailable extends Error {}

/** The text a person would paste by hand when a write is refused. */
function snippetOf(t: ApplyTarget): string {
  switch (t.kind) {
    case 'description': return t.text;
    case 'context_create': return t.description || t.name;
    case 'context_update': return t.description || t.name;
    case 'mart_contexts': return t.contextIds.join(', ');
    case 'settings': return JSON.stringify(t.patch);
    case 'model': return t.action;
  }
}

const refusedBy = (e: unknown) => statusesOf(e).some((s) => s === 401 || s === 403);

async function write(t: ApplyTarget, { owox, store, onModel }: ApplyDeps): Promise<void> {
  const put = (path: string, body: unknown) => { if (!owox.putJson) throw new Unavailable(); return owox.putJson(path, body); };
  switch (t.kind) {
    case 'settings':
      if (Object.keys(t.patch).length) await saveProjectSettings(store, t.patch);
      return;
    case 'description': {
      const cur = (await owox.project.getSettings()).description;
      const next = t.mode === 'append' ? (cur?.trim() ? `${cur}\n\n${t.text}` : t.text) : upsertMetricsTable(cur, t.text);
      if (owox.project.updateDescription) await owox.project.updateDescription(next);
      else await put('/api/projects/settings/description', { description: next });
      return;
    }
    case 'context_create':
      if (!owox.postJson) throw new Unavailable();
      await owox.postJson('/api/contexts', { name: t.name, description: t.description });
      return;
    case 'context_update': await put(`/api/contexts/${encodeURIComponent(t.id)}`, { name: t.name, description: t.description }); return;
    case 'mart_contexts': await put(`/api/data-marts/${encodeURIComponent(t.martId)}/contexts`, { contextIds: t.contextIds }); return;
    case 'model': onModel(t.action); return;
  }
}

/** Writes one answer. A 401 or 403, or a client that can't write, returns the snippet instead; any other failure returns its message. */
export async function applyTarget(t: ApplyTarget, deps: ApplyDeps): Promise<ApplyResult> {
  try {
    await write(t, deps);
    return { ok: true };
  } catch (e) {
    if (e instanceof Unavailable || refusedBy(e)) return { ok: false, refused: true, snippet: snippetOf(t) };
    return { ok: false, refused: false, error: describeError(e) };
  }
}
