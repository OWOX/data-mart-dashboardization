import { MoveRight, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import type { MetricDef, MetricResult } from '../types';
import { compact } from '../lib/format';

export function Badge({ metric, result }: { metric: MetricDef; result: MetricResult | undefined }) {
  const failed = !result || result.error !== null;
  const status = failed ? 'neutral' : result.status;
  const trend = failed ? 'flat' : result.trend;
  // The same trend glyphs as the one before the main number, and as the owox.com map's badges.
  const Icon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : MoveRight;
  return (
    <span className="gy-badge" data-status={status}>
      <Icon size={12} aria-label={`trend ${trend}`} />
      <span className="num gy-badge-value">{failed ? '—' : compact(result.fact ?? result.forecast)}</span>{' '}
      <span className="gy-badge-name" title={metric.alias}>{metric.alias}</span>
      {result?.warning && <span className="gy-warn" title={result.warning}><TriangleAlert size={12} aria-label="Warning" /></span>}
    </span>
  );
}
