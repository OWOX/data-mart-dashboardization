import { aggLabel } from '../lib/compile';
import { formatNumber } from '../lib/format';
import type { Component, QueryResult, ScorecardConfig } from '../lib/types';

/**
 * The value comes from `totals`, which the server computes over ALL matching rows (ignoring the
 * row limit). Never sum `rows` here — that would be a client-side calculation and would also be
 * wrong whenever the result is truncated. The lookup key MUST come from `aggLabel` — it mirrors
 * the backend's alias exactly (COUNT_DISTINCT -> COUNTUNIQUE, P50 -> MEDIAN, dots -> `_`); a
 * hand-rolled key doesn't throw, it silently reads `undefined` and renders a blank/NaN number.
 * `formatNumber` is `unknown`-hardened, so a missing/null/non-numeric total renders as `—` rather
 * than blank/NaN.
 */
export function Scorecard({ component, data }: { component: Component; data: QueryResult | null }) {
  const c = component.config as ScorecardConfig;
  const value = data?.totals?.[aggLabel(c.metric, c.aggregation)];
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="text-2xl font-semibold">{formatNumber(value)}</div>
      <div className="text-xs text-muted-foreground">{c.aggregation} of {c.metric}</div>
    </div>
  );
}
