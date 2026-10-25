import type { CardCache, ClassNode, MetricDef } from '../types';
import { compact, formatPct, metricLabel } from '../lib/format';
import { Badge } from './Badge';
import { Sparkline } from './Sparkline';

interface Props {
  cls: ClassNode;
  metrics: MetricDef[];
  cache: CardCache | undefined;
  comparisonOn: boolean;
  refreshing: boolean;
  noAccess?: boolean;
  onRetry: () => void;
}

export function Card({ cls, metrics, cache, comparisonOn, refreshing, noAccess, onRetry }: Props) {
  const key = metrics.find((m) => m.id === cls.keyMetricId);
  const res = key ? cache?.metrics[key.id] : undefined;
  const header = <header className="label">{cls.title}</header>;

  if (noAccess) {
    return (
      <article className="gy-card" data-class-id={cls.id} data-status="empty">
        {header}
        <p className="gy-muted">You don't have access to this Data Mart</p>
      </article>
    );
  }
  if (!key) {
    return (
      <article className="gy-card" data-class-id={cls.id} data-status="empty">
        {header}
        <p className="gy-muted">No metric yet</p>
      </article>
    );
  }
  if (res?.error) {
    return (
      <article className="gy-card" data-class-id={cls.id} data-status="error">
        {header}
        <p className="gy-muted">Couldn't load</p>
        <button type="button" className="gy-btn" onClick={onRetry}>Retry</button>
      </article>
    );
  }
  if (!res) {
    return (
      <article className="gy-card" data-class-id={cls.id} data-status="empty" aria-busy={refreshing}>
        {header}
        <p className="gy-muted">{refreshing ? 'Loading…' : '—'}</p>
      </article>
    );
  }

  const big = res.fact !== null ? compact(res.fact) : res.forecast !== null ? `Forecast ${res.forecastApprox ? '≈' : ''}${compact(res.forecast)}` : compact(null);
  const badges = metrics.filter((m) => m.id !== key.id).map((m) => <Badge key={m.id} metric={m} result={cache?.metrics[m.id]} />);
  const foot = [
    res.plan !== null ? `plan ${compact(res.plan)}` : null,
    res.forecast !== null ? `forecast ${res.forecastApprox ? '≈' : ''}${compact(res.forecast)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <article className="gy-card" data-class-id={cls.id} data-status={res.status} aria-busy={refreshing}>
      {header}
      <div className="gy-card-value">
        <span className="num gy-big">{big}</span>
        {comparisonOn && res.diffPct !== null && (
          <span className="num gy-diff" data-sign={res.diffPct > 0 ? '+' : res.diffPct < 0 ? '-' : '0'}>{formatPct(res.diffPct)}</span>
        )}
      </div>
      <div className="gy-card-label">{metricLabel(key.alias, cls.title, key.isUniqueCount)}</div>
      {cache?.spark && <Sparkline spark={cache.spark} trend={res.trend} />}
      {badges.length > 0 && <div className="gy-badges">{badges}</div>}
      <footer className="gy-card-foot num">
        {foot}
        {res.note === 'short_history' && ' Not enough history to forecast'}
        {res.note === 'no_date_field' && ' All time'}
      </footer>
    </article>
  );
}
