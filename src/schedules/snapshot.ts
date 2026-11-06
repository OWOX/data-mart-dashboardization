import type { CollectionsLike } from '../store/collections';
import type { ClassNode, MetricDef, Model } from '../types';

/** A member's model split by Data Mart, for scheduled runs, which act as the installer and can't read the member's own ontology. */
export const SCHEDULE_MODELS = 'schedule-models';

export interface ModelSlice { v: 1; builtAt: string; editedAt: string | null; classes: ClassNode[]; metrics: MetricDef[] }

export const martIdsOf = (m: Model): string[] => [...new Set(m.classes.map((c) => c.martId))].sort();

export async function writeSnapshot(store: CollectionsLike, model: Model, memberId: string): Promise<string[]> {
  const col = store.collections<ModelSlice>(SCHEDULE_MODELS);
  const ids = martIdsOf(model);
  for (const martId of ids) {
    await col.put(`${memberId}:${martId}`, {
      v: 1, builtAt: model.builtAt, editedAt: model.editedAt,
      classes: model.classes.filter((c) => c.martId === martId),
      metrics: model.metrics.filter((x) => x.martId === martId),
    }, { parentId: martId });
  }
  return ids;
}

/** The model rebuilt from the slices that exist; only what refreshCanvas reads is filled. */
export async function readSnapshot(store: CollectionsLike, memberId: string, martIds: string[]): Promise<Model | null> {
  const col = store.collections<ModelSlice>(SCHEDULE_MODELS);
  const slices = (await Promise.all(martIds.map((id) => col.get(`${memberId}:${id}`).catch(() => null))))
    .map((d) => d?.document).filter((d): d is ModelSlice => d?.v === 1);
  const first = slices[0]?.classes[0];
  if (!first) return null;
  return {
    version: 2, inputHash: '', builtAt: slices[0]!.builtAt, builtBy: memberId, editedAt: slices[0]!.editedAt,
    goal: { classId: first.id, metricId: null, goalMartId: first.martId, viaFallback: true },
    classes: slices.flatMap((s) => s.classes), edges: [], metrics: slices.flatMap((s) => s.metrics),
  };
}
