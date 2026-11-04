import type { Model } from '../types';
import type { MartDetail } from '../owox/sources';
import { uncomputable } from './aggregations';

/**
 * The model as drawn and queried: hidden classes are dropped (the goal class never is), hidden metrics
 * leave `metricIds`, and a hidden key metric falls back to the first shown one, or to none.
 * With the live schemas, a metric whose field refuses its aggregation is hidden too; its `shown` flag stays.
 */
export function shownModel(model: Model, details?: ReadonlyMap<string, MartDetail>): Model {
  const hidden = new Set(model.metrics.filter((m) => m.shown === false || (details && uncomputable(m, details.get(m.martId)))).map((m) => m.id));
  if (hidden.size === 0 && model.classes.every((c) => c.shown !== false)) return model;
  return {
    ...model,
    classes: model.classes
      .filter((c) => c.shown !== false || c.id === model.goal.classId)
      .map((c) => {
        const metricIds = c.metricIds.filter((id) => !hidden.has(id));
        const keyMetricId = c.keyMetricId && !hidden.has(c.keyMetricId) ? c.keyMetricId : metricIds[0] ?? null;
        return { ...c, metricIds, keyMetricId };
      }),
  };
}
