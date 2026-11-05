import type { Model } from '../types';
import type { MartDetail } from '../owox/sources';
import { canBeClass } from './graph';

/** A member's first ontology: the project model cut to the classes whose Data Marts they can reach, plus the goal class. */
export function seedFrom(project: Model, accessible: ReadonlySet<string>): Model {
  const keep = new Set(project.classes.filter((c) => accessible.has(c.martId) || c.id === project.goal.classId).map((c) => c.id));
  return {
    ...project,
    classes: project.classes.filter((c) => keep.has(c.id)),
    edges: project.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
    metrics: project.metrics.filter((m) => keep.has(m.martId)),
  };
}

/** The model without the classes whose Data Mart can't be a class any more (no date field); a class with no schema to hand, and the goal class, stay. */
export function withoutUndated(model: Model, details: ReadonlyMap<string, MartDetail>): Model {
  const drop = new Set(model.classes.filter((c) => c.id !== model.goal.classId && details.has(c.martId) && !canBeClass(details.get(c.martId)!)).map((c) => c.id));
  if (drop.size === 0) return model;
  return {
    ...model,
    classes: model.classes.filter((c) => !drop.has(c.id)),
    edges: model.edges.filter((e) => !drop.has(e.from) && !drop.has(e.to)),
    metrics: model.metrics.filter((m) => !drop.has(m.martId)),
  };
}
