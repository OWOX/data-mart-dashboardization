import type { MetricDef, MetricResult } from '../types';

export type Direction = 'up' | 'down' | 'flat';

/**
 * The arrow a metric wears, on the card's big number and on its badge alike: the change against the
 * comparison when one can be made, else the series' own trend. A failed or missing result is flat.
 */
export function directionOf(result: MetricResult | undefined, metric: MetricDef, comparing: boolean): Direction {
  if (!result || result.error != null) return 'flat';
  const fact = result.compareFact ?? result.fact;
  if (comparing && result.fact !== null && metric.dateField !== null && fact !== null && result.comparison !== null) {
    const delta = fact - result.comparison;
    return delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  }
  return result.trend;
}
