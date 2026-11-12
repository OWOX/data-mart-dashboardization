import type { Model } from '../types';

export const model: Model = {
  version: 3, inputHash: 'h', builtAt: 'b1', builtBy: 'u', editedAt: null, editedBy: null,
  goal: { classId: 'a', metricId: null, goalMartId: 'a', viaFallback: false },
  classes: [{ id: 'a', martId: 'a', title: 'A', contexts: [], depth: 0, keyMetricId: null, metricIds: [], shown: true, core: false, inbound: 0 }],
  edges: [], metrics: [],
};

/** Seeds the shared model doc without the conflict check. */
export const seedShared = (store: { collections<T>(name: string): { put(id: string, doc: T): Promise<unknown> } }, m: Model) => store.collections<Model>('ontology_project').put('current', m);
