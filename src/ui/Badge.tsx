import { MoveRight, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import type { MetricDef, MetricResult } from '../types';
import { formatValue } from '../lib/format';

export function Badge({ metric, name = metric.alias, result, onPick }: { metric: MetricDef; name?: string; result: MetricResult | undefined; onPick?: () => void }) {
  const failed = !result || result.error != null;
  const status = failed ? 'neutral' : result.status;
  const trend = failed ? 'flat' : result.trend;
  // The same trend glyphs as the one before the main number, and as the owox.com map's badges.
  const Icon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : MoveRight;
  const value = failed ? '—' : formatValue(result.fact ?? result.forecast, metric);
  const Tag = onPick ? 'button' : 'span';
  return (
    <Tag className="gy-badge" data-status={status} title={`${value} ${name}`} {...(onPick ? { type: 'button' as const, 'aria-label': `Show ${name}, ${value}`, onClick: onPick } : {})}>
      <Icon size={12} aria-label={`trend ${trend}`} />
      <span className="num gy-badge-value">{value}</span>{' '}
      <span className="gy-badge-name">{name}</span>
      {result?.warning && <span className="gy-warn" title={result.warning}><TriangleAlert size={12} aria-label="Warning" /></span>}
    </Tag>
  );
}
