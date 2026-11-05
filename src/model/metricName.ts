import type { MetricDef } from '../types';
import type { MartDetail } from '../owox/sources';
import { fieldAt } from './aggregations';

/** The Data Mart field's name as OWOX shows it: its alias when set, else the field path. */
export function fieldLabel(alias: string | undefined, path: string): string {
  return alias?.trim() || path;
}

/**
 * A metric's display name. The live field's alias, else its name; the stored alias only when the
 * live field can't be read (schema not loaded, field deleted). A unique count keeps its class title.
 */
export function metricName(metric: MetricDef, detail: MartDetail | undefined): string {
  if (metric.isUniqueCount) return metric.alias;
  const field = detail ? fieldAt(detail, metric.measure.field) : undefined;
  return field ? fieldLabel(field.alias, metric.measure.field) : metric.alias;
}
