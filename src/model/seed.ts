import type { Model } from '../types';

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
