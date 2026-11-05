import { MoveRight, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import type { MetricDef, MetricResult } from '../types';
import { formatValue, formatWindow } from '../lib/format';
import { directionOf } from '../lib/direction';
import { shownValue } from '../lib/stats';

export function Badge({ metric, name = metric.alias, comparing = false, result, onPick }: { metric: MetricDef; name?: string; comparing?: boolean; result: MetricResult | undefined; onPick?: () => void }) {
  const failed = !result || result.error != null;
  const status = failed ? 'neutral' : result.status;
  const trend = directionOf(result, metric, comparing);
  // The same trend glyphs as the one before the main number, and as the owox.com map's badges.
  const Icon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : MoveRight;
  const proj = failed ? null : result.projection;
  const value = failed ? '—' : `${proj && result.forecastApprox ? '≈' : ''}${formatValue(shownValue(result) ?? result.forecast, metric)}${proj ? '*' : ''}`;
  // a projected value is a whole-period figure that is partly forecast, which the hover says
  const basis = proj ? ` (Actual to ${formatWindow({ from: proj.factWindow.to, to: proj.factWindow.to }, false)} + forecast to ${formatWindow({ from: proj.forecastWindow.to, to: proj.forecastWindow.to }, false)})` : '';
  const Tag = onPick ? 'button' : 'span';
  return (
    <Tag className="gy-badge" data-status={status} title={`${value} ${name}${basis}`} {...(onPick ? { type: 'button' as const, 'aria-label': `Show ${name}, ${value}`, onClick: onPick } : {})}>
      <Icon size={12} aria-label={`trend ${trend}`} />
      <span className="num gy-badge-value">{value}</span>{' '}
      <span className="gy-badge-name">{name}</span>
      {result?.warning && <span className="gy-warn" title={result.warning}><TriangleAlert size={12} aria-label="Warning" /></span>}
    </Tag>
  );
}
