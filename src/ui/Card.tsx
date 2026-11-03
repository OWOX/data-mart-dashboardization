import { Info } from 'lucide-react';
import type { CardCache, ClassNode, MetricDef } from '../types';
import { diffPct } from '../lib/stats';
import { compact, formatDelta, formatPct } from '../lib/format';
import { Badge } from './Badge';
import { MartIcon } from './MartIcon';
import { Sparkline } from './Sparkline';

/** What the mart list says about a class's mart; read live, so it is never older than the page. */
export interface MartInfo { description: string | null; icon: string | null }

interface Props {
  cls: ClassNode;
  mart?: MartInfo;
  metrics: MetricDef[];
  cache: CardCache | undefined;
  comparisonOn: boolean;
  refreshing: boolean;
  noAccess?: boolean;
  /** 'vs Last Month' and the like; the comparison row shows only when it is given and comparison is on. */
  compareLabel?: string;
  /** The diff chip shows an absolute difference instead of a relative one. */
  absolute?: boolean;
  onToggleDiff?: () => void;
  onRetry: () => void;
}

/** The mart's icon, then two lines: the class in grey and the metric under it. */
function CardHead({ title, metric, mart, metrics }: { title: string; metric?: string; mart?: MartInfo; metrics: MetricDef[] }) {
  const about = mart?.description?.trim() || null;
  const described = metrics.filter((m) => m.description);
  return (
    <header className="gy-card-head">
      <span className="gy-logo"><MartIcon icon={mart?.icon} size={20} /></span>
      <span className="gy-card-names">
        <span className="gy-card-title">{title}</span>
        {metric && <span className="gy-card-metric">{metric}</span>}
      </span>
      {(about || described.length > 0) && (
        <span className="gy-hint" tabIndex={0} aria-label={`About ${title}`}>
          <Info size={14} />
          <span className="gy-hint-body" role="tooltip">
            {about && <span className="gy-hint-about">{about}</span>}
            {described.map((m) => (
              <span key={m.id}><b>{m.alias}</b> · {m.description}</span>
            ))}
          </span>
        </span>
      )}
    </header>
  );
}

/** A chip with the difference (pressing it swaps relative and absolute), then "vs" and the comparison's name. */
function Compare({ delta, pct, sign, label, absolute, onToggle }: {
  delta: number | null; pct: number | null; sign: Sign; label: string; absolute: boolean; onToggle?: () => void;
}) {
  // A zero comparison has no relative difference, so the chip can only say the absolute one.
  const showAbs = absolute || pct === null;
  const text = delta === null ? '—' : showAbs ? formatDelta(delta) : formatPct(pct);
  return (
    <div className="gy-compare" data-sign={sign}>
      <button
        type="button" className="num gy-delta" onClick={onToggle} disabled={!onToggle || pct === null}
        title={showAbs ? 'Show the difference in %' : 'Show the difference in absolute numbers'}
      >
        {text}
      </button>
      <span className="gy-compare-label">vs {label}</span>
    </div>
  );
}

type Sign = 'up' | 'down' | 'flat';

/**
 * Lucide's trending-up, trending-down and move-right, the glyphs the owox.com map leads its badges
 * with. The view box is cropped to the glyph so it fills the column under the icon; the stroke
 * keeps its width however large it is drawn.
 */
const BIG_ARROW: Record<Sign, { box: string; d: string[] }> = {
  up: { box: '1 6 22 12', d: ['M16 7h6v6', 'm22 7-8.5 8.5-5-5L2 17'] },
  down: { box: '1 6 22 12', d: ['M16 17h6v-6', 'm22 17-8.5-8.5-5 5L2 7'] },
  flat: { box: '1 6 22 12', d: ['M18 8l4 4-4 4', 'M2 12h20'] },
};

function TrendArrow({ sign }: { sign: Sign }) {
  const a = BIG_ARROW[sign];
  return (
    <svg className="gy-trend-arrow" viewBox={a.box} role="img" aria-label={`direction ${sign}`}>
      {a.d.map((d) => <path key={d} d={d} vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}

export function Card({ cls, mart, metrics, cache, comparisonOn, refreshing, noAccess, compareLabel, absolute = false, onToggleDiff, onRetry }: Props) {
  const key = metrics.find((m) => m.id === cls.keyMetricId);
  const res = key ? cache?.metrics[key.id] : undefined;
  const header = <CardHead title={cls.title} metric={noAccess || !key ? undefined : key.isUniqueCount ? 'Count' : key.alias} mart={mart} metrics={noAccess ? [] : metrics} />;

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

  // A comparison shorter than the range recounts the value over the same number of days.
  const fact = res.compareFact ?? res.fact;
  const comparison = res.comparison;
  const canCompare = comparisonOn && !!compareLabel && res.fact !== null && key.dateField !== null;
  const delta = canCompare && fact !== null && comparison !== null ? fact - comparison : null;
  // Against the comparison when there is one, else the series' own direction.
  const sign: Sign = delta !== null ? (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat') : res.trend;
  const big = fact !== null ? compact(fact) : res.forecast !== null ? `${res.forecastApprox ? '≈' : ''}${compact(res.forecast)}` : compact(null);
  const badges = metrics.filter((m) => m.id !== key.id).map((m) => <Badge key={m.id} metric={m} result={cache?.metrics[m.id]} />);
  // Plan and forecast stay off the face of the card; the number names them on hover.
  const detail = [
    res.plan !== null ? `Plan ${compact(res.plan)}` : null,
    res.forecast !== null ? `Forecast ${res.forecastApprox ? '≈' : ''}${compact(res.forecast)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <article className="gy-card" data-class-id={cls.id} data-status={res.status} aria-busy={refreshing}>
      {header}
      {/* The arrow sits under the icon, so the number lines up with the names above it. */}
      <div className="gy-card-body">
        <span className="gy-trend" data-sign={sign}><TrendArrow sign={sign} /></span>
        <span className="num gy-big" title={detail || undefined}>{big}</span>
        {badges.length > 0 && <div className="gy-badges">{badges}</div>}
      </div>
      {/* An all-time metric has no period to compare against. */}
      {canCompare && (
        <Compare
          delta={delta} pct={fact !== null ? diffPct(fact, comparison) : null} sign={sign}
          label={compareLabel} absolute={absolute} onToggle={onToggleDiff}
        />
      )}
      {res.note && (
        <footer className="gy-card-foot">
          {res.note === 'short_history' ? 'Not enough history to forecast' : 'All time'}
        </footer>
      )}
      {cache?.spark && <Sparkline spark={cache.spark} trend={res.trend} />}
    </article>
  );
}
