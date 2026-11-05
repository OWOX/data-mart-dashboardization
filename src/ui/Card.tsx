import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ExternalLink, Info, ShieldAlert, ShieldCheck, ShieldX, TriangleAlert } from 'lucide-react';
import { qualityBadge, type QualitySummary } from '../owox/quality';
import type { CardCache, ClassNode, MetricDef } from '../types';
import type { MartDetail } from '../owox/sources';
import type { MarkdownHtml } from '../lib/markdown';
import { fieldAt } from '../model/aggregations';
import { metricName } from '../model/metricName';
import { diffPct } from '../lib/stats';
import { directionOf } from '../lib/direction';
import { formatDeltaFor, formatPct, formatValue } from '../lib/format';
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
  /** The class's Data Mart no longer exists. */
  missing?: boolean;
  /** 'vs Last Month' and the like; the comparison row shows only when it is given and comparison is on. */
  compareLabel?: string;
  /** The diff chip shows an absolute difference instead of a relative one. */
  absolute?: boolean;
  onToggleDiff?: () => void;
  /** OWOX's data-quality summary of the class's Data Mart; the shield icon shows only for the states that earn one. */
  quality?: QualitySummary;
  projectId?: string;
  /** Opens an OWOX page by path; without it the card has no link to its Data Mart. */
  onOpen?: (path: string) => void;
  /** Live schemas by Data Mart id: metric names and descriptions come from their fields. */
  details?: ReadonlyMap<string, MartDetail>;
  /** Renders the Data Mart description's Markdown; without it the raw text shows. */
  markdown?: MarkdownHtml;
  onRetry: () => void;
}

const SHOWN = 3;

/** The live description of a metric's field, trimmed; undefined when there is none. */
const fieldNote = (detail: MartDetail | undefined, path: string): string | undefined =>
  (detail ? fieldAt(detail, path)?.description?.trim() : undefined) || undefined;

/** The first three secondary metrics; the rest open as a panel over whatever is under the card, so the card keeps its height. */
function Badges({ items, cache, nameOf, comparing, onPick }: { items: MetricDef[]; cache: CardCache | undefined; nameOf: (m: MetricDef) => string; comparing: boolean; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const id = useId();
  const rest = items.slice(SHOWN);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); toggle.current?.focus(); } };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key, true); };
  }, [open]);
  const badge = (m: MetricDef) => (
    <Badge key={m.id} metric={m} name={nameOf(m)} comparing={comparing} result={cache?.metrics[m.id]} onPick={() => { setOpen(false); onPick(m.id); }} />
  );
  return (
    <div className="gy-badges" ref={ref}>
      {items.slice(0, SHOWN).map(badge)}
      {rest.length > 0 && (
        <button ref={toggle} type="button" className="gy-more" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : `Show +${rest.length} more`}
        </button>
      )}
      {open && rest.length > 0 && <div className="gy-badges-panel" id={id}>{rest.map(badge)}</div>}
    </div>
  );
}

/** The corner's icons, shown while the card is pointed at or holds focus; more can be passed as children, first in the row. */
export function CardTools({ children }: { children?: ReactNode }) {
  return <span className="gy-card-tools">{children}</span>;
}

const SHIELD = { passed: ShieldCheck, issues: ShieldAlert, failed: ShieldX };

/** The data-quality shield: green when every check passed, orange or red for issues, red when the run failed. */
function QualityTool({ quality, path, onOpen }: { quality?: QualitySummary; path: string; onOpen: (path: string) => void }) {
  const badge = quality && qualityBadge(quality);
  if (!badge) return null;
  const Icon = SHIELD[badge.kind];
  return (
    <button type="button" className="gy-tool gy-quality" data-tone={badge.tone} aria-label={badge.label} onClick={() => onOpen(path)}>
      <Icon size={14} />
      <span className="gy-hint-body" role="tooltip" aria-hidden="true">{badge.label}</span>
    </button>
  );
}

/** An (i) whose bubble opens on hover or focus and closes on Escape, blur or leaving; `onOpen` fires each time it opens. */
function Tip({ label, className = '', onOpen, children }: { label: string; className?: string; onOpen?: () => void; children: (bubbleId: string) => ReactNode }) {
  const bubble = useId();
  const [open, setOpen] = useState(false);
  const show = () => { if (!open) onOpen?.(); setOpen(true); };
  return (
    <span
      className={`gy-hint gy-cardtip ${className}`.trim()} tabIndex={0} role="button" aria-label={label} aria-describedby={bubble} data-open={open}
      onMouseEnter={show} onMouseLeave={() => setOpen(false)} onFocus={show} onBlur={() => setOpen(false)}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}
    >
      <Info size={14} />
      {children(bubble)}
    </span>
  );
}

/** The Data Mart's description, as Markdown rendered by OWOX once it arrives; the raw text until then, or when it can't be had. */
function MartAbout({ martId, title, text, markdown }: { martId: string; title: string; text: string; markdown?: MarkdownHtml }) {
  const [html, setHtml] = useState<string | null>(() => markdown?.peek(martId, text) ?? null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  // a changed description starts over from the raw text
  useEffect(() => { setHtml(markdown?.peek(martId, text) ?? null); }, [martId, text, markdown]);
  const current = useRef('');
  current.current = `${martId}\u0000${text}`;
  const load = () => {
    if (!markdown || html !== null) return;
    const asked = current.current;
    // a result for a description that has since changed is dropped
    void markdown.load(martId, text).then((h) => { if (live.current && h !== null && current.current === asked) setHtml(h); });
  };
  return (
    <Tip label={`About ${title}`} onOpen={load}>
      {(id) => (
        <span id={id} className="gy-hint-body gy-hint-md" role="tooltip">
          {html !== null
            ? <div className="gy-md" dangerouslySetInnerHTML={{ __html: html }} />
            : <span className="gy-hint-about">{text}</span>}
        </span>
      )}
    </Tip>
  );
}

/** The mart's icon, then two lines: the class in grey and the metric under it. */
function CardHead({ title, martId, metric, metricNote, mart, markdown, openPath, onOpen, tools }: {
  title: string; martId: string; metric?: string; metricNote?: string; mart?: MartInfo; markdown?: MarkdownHtml; openPath?: string; onOpen?: (path: string) => void; tools?: ReactNode;
}) {
  const about = mart?.description?.trim() || null;
  const link = onOpen && openPath;
  return (
    <header className="gy-card-head">
      <span className="gy-logo"><MartIcon icon={mart?.icon} size={20} /></span>
      <span className="gy-card-names">
        <span className="gy-card-title">{title}</span>
        {metric && (
          <span className="gy-card-metric-row">
            <span className="gy-card-metric">{metric}</span>
            {metricNote && (
              <span className="gy-metric-tip">
                <Tip label={`About ${metric}`}>
                  {(id) => <span id={id} className="gy-hint-body gy-hint-left" role="tooltip">{metricNote}</span>}
                </Tip>
              </span>
            )}
          </span>
        )}
      </span>
      {(about || link || tools) && (
        <CardTools>
          {tools}
          {link && (
            <button type="button" className="gy-tool" aria-label={`Open ${title} in OWOX`} onClick={() => onOpen(openPath)}>
              <ExternalLink size={14} />
            </button>
          )}
          {about && <MartAbout martId={martId} title={title} text={about} markdown={markdown} />}
        </CardTools>
      )}
    </header>
  );
}

/** A chip with the difference (pressing it swaps relative and absolute), then "vs" and the comparison's name. */
function Compare({ delta, pct, metric, sign, label, absolute, onToggle }: {
  delta: number | null; pct: number | null; metric: MetricDef; sign: Sign; label: string; absolute: boolean; onToggle?: () => void;
}) {
  // A zero comparison has no relative difference, so the chip can only say the absolute one.
  const showAbs = absolute || pct === null;
  const text = delta === null ? '—' : showAbs ? formatDeltaFor(delta, metric) : formatPct(pct);
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

/** A warning icon whose tooltip says what is wrong, in the style of the info hint. */
export function WarningHint({ text }: { text: string }) {
  return (
    <span className="gy-hint gy-warn" tabIndex={0} aria-label="Warning">
      <TriangleAlert size={14} />
      <span className="gy-hint-body" role="tooltip">{text}</span>
    </span>
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

export function Card({ cls, mart, metrics, cache, comparisonOn, refreshing, noAccess, missing, compareLabel, absolute = false, onToggleDiff, projectId = '', quality, details, markdown, onOpen, onRetry }: Props) {
  const nameOf = (m: MetricDef) => metricName(m, details?.get(m.martId));
  // The metric the reader swapped in for this session, with the secondary order it leaves behind.
  const [swap, setSwap] = useState<{ main: string; rest: string[] } | null>(null);
  const home = metrics.find((m) => m.id === cls.keyMetricId);
  const ids = metrics.map((m) => m.id).sort().join();
  const swapped = swap && [swap.main, ...swap.rest].sort().join() === ids ? swap : null;
  const key = swapped ? metrics.find((m) => m.id === swapped.main) : home;
  const secondary = swapped
    ? swapped.rest.flatMap((id) => metrics.find((m) => m.id === id) ?? [])
    : metrics.filter((m) => m.id !== key?.id);
  // a new key metric on the class drops the reader's swap
  const order = cls.metricIds.join();
  useEffect(() => setSwap(null), [cls.keyMetricId, order]);
  const pick = (id: string) => { if (key) setSwap({ main: id, rest: secondary.map((m) => (m.id === id ? key.id : m.id)) }); };
  const res = key ? cache?.metrics[key.id] : undefined;
  const comparingNow = comparisonOn && !!compareLabel;
  const hidden = noAccess || missing || !key;
  const note = key && !key.isUniqueCount ? fieldNote(details?.get(key.martId), key.measure.field) : undefined;
  const header = <CardHead title={cls.title} martId={cls.martId} metric={hidden ? undefined : key.isUniqueCount ? 'Count' : nameOf(key)} metricNote={hidden ? undefined : note} mart={mart} markdown={markdown} openPath={noAccess || missing ? undefined : `/ui/${projectId}/data-marts/${cls.martId}/overview`} onOpen={onOpen} tools={onOpen && !noAccess && !missing ? <QualityTool quality={quality} path={`/ui/${projectId}/data-marts/${cls.martId}/quality`} onOpen={onOpen} /> : undefined} />;

  if (missing) {
    return (
      <article className="gy-card" data-class-id={cls.id} data-status="empty">
        {header}
        <p className="gy-muted"><TriangleAlert size={14} aria-label="Warning" /> Data Mart not found or not accessible</p>
      </article>
    );
  }
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
  if (!res) {
    return (
      <article className="gy-card" data-class-id={cls.id} data-status="empty" aria-busy={refreshing}>
        {header}
        <p className="gy-muted">—</p>
      </article>
    );
  }

  const failed = res.error != null;
  // A comparison shorter than the range recounts the value over the same number of days.
  const fact = res.compareFact ?? res.fact;
  const comparison = res.comparison;
  const canCompare = !failed && comparisonOn && !!compareLabel && res.fact !== null && key.dateField !== null;
  const delta = canCompare && fact !== null && comparison !== null ? fact - comparison : null;
  // Against the comparison when there is one, else the series' own direction.
  const sign: Sign = directionOf(res, key, comparingNow);
  // a failed query shows no number; the error rides in the tooltip and the card offers a retry
  const warning = res.warning ?? res.error;
  const big = failed ? formatValue(null, key) : fact !== null ? formatValue(fact, key) : res.forecast !== null ? `${res.forecastApprox ? '≈' : ''}${formatValue(res.forecast, key)}` : formatValue(null, key);
  // Plan and forecast stay off the face of the card; the number names them on hover.
  const detail = [
    res.plan !== null ? `Plan ${formatValue(res.plan, key)}` : null,
    res.forecast !== null ? `Forecast ${res.forecastApprox ? '≈' : ''}${formatValue(res.forecast, key)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <article className="gy-card" data-class-id={cls.id} data-status={failed ? 'error' : res.status} aria-busy={refreshing}>
      {header}
      {/* The arrow sits under the icon, so the number lines up with the names above it. */}
      <div className="gy-card-body">
        <span className="gy-trend" data-sign={sign}><TrendArrow sign={sign} /></span>
        <span className="num gy-big" title={detail || undefined}>{big}</span>
        {warning && <WarningHint text={warning} />}
        {secondary.length > 0 && <Badges items={secondary} cache={cache} nameOf={nameOf} comparing={comparingNow} onPick={pick} />}
      </div>
      {failed && <button type="button" className="gy-link" onClick={onRetry}>Retry</button>}
      {/* An all-time metric has no period to compare against. */}
      {canCompare && (
        <Compare
          delta={delta} metric={key} pct={fact !== null ? diffPct(fact, comparison) : null} sign={sign}
          label={compareLabel} absolute={absolute} onToggle={onToggleDiff}
        />
      )}
      {res.note && (
        <footer className="gy-card-foot">
          {res.note === 'short_history' ? 'Not enough history to forecast' : 'All time'}
        </footer>
      )}
      {/* Only the class's own key metric has a series; a swapped-in metric keeps the slot's height so the card doesn't shrink. */}
      {cache?.spark && (key.id === home?.id
        ? <Sparkline spark={cache.spark} trend={res.trend} />
        : <div className="gy-spark-slot" aria-hidden="true" />)}
    </article>
  );
}
