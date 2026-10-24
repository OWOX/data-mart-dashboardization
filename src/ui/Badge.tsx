import { MoveRight, TrendingDown, TrendingUp } from 'lucide-react';
import type { MetricDef, MetricResult } from '../types';
import { compact } from '../lib/format';

export function Badge({ metric, result }: { metric: MetricDef; result: MetricResult | undefined }) {
  const failed = !result || result.error !== null;
  const status = failed ? 'neutral' : result.status;
  const trend = failed ? 'flat' : result.trend;
  const Icon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : MoveRight;
  return (
    <span className="gy-badge" data-status={status}>
      <span className="num">{failed ? '—' : compact(result.fact ?? result.forecast)}</span>{' '}
      {metric.alias}
      <Icon size={12} aria-label={`trend ${trend}`} />
    </span>
  );
}
