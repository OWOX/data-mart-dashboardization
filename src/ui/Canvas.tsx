import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Network, Target } from 'lucide-react';
import type { CacheDoc, ClassNode, Model, Status, WeekStart } from '../types';
import type { MartDetail } from '../owox/sources';
import type { QualitySummary } from '../owox/quality';
import type { MarkdownHtml } from '../lib/markdown';
import { shownModel } from '../model/shown';
import { Card, type MartInfo } from './Card';
import { LoadingBar, type LoadingProgress } from './LoadingBar';
import { contextsOf, layoutFor, type Connector } from './layout';

interface Props {
  model: Model;
  cache: CacheDoc | null;
  comparisonOn: boolean;
  refreshing: boolean;
  /** Marts the member can see; null means no restriction. */
  visibleIds?: ReadonlySet<string> | null;
  /** Live schemas: metrics their fields can't aggregate are left off. */
  details?: ReadonlyMap<string, MartDetail>;
  /** Classes whose Data Mart no longer exists. */
  missingIds?: ReadonlySet<string>;
  /** Live description and definition type per mart id, from the mart list. */
  marts?: ReadonlyMap<string, MartInfo>;
  /** 'vs Last Month' and the like, for the comparison row under each number. */
  compareLabel?: string;
  /** Controls shown at the end of the toolbar, level with the context chips. */
  tools?: ReactNode;
  /** Metrics done of total, once known; the line above the bands fills to it. */
  progress?: LoadingProgress | null;
  /** Data-quality summaries by Data Mart id; absent when the call failed. */
  quality?: ReadonlyMap<string, QualitySummary> | null;
  projectId?: string;
  /** Renders a mart description's Markdown; without it the card shows the raw text. */
  markdown?: MarkdownHtml;
  onOpen?: (path: string) => void;
  weekStart?: WeekStart;
  onRetry: () => void;
}

/** A line's colour: a status of the calculated metric it stands for, or 'none' when no metric on the canvas is one of its fields. */
export type Tone = Status | 'none';
const TONES: Tone[] = ['neutral', 'above', 'near', 'below', 'none'];

/**
 * A line stands for the calculated fields of `from` that reference `to`, so it wears the plan
 * status of the metric those fields are, the way a card wears its key metric's. Only a metric
 * that is itself a calculated field of `from` counts; with none, the line stays uncoloured. The
 * class's key metric wins when several qualify; a metric with no result yet is neutral.
 */
export function lineTone(c: Connector, model: Model, cache: CacheDoc | null): Tone {
  const cls = model.classes.find((x) => x.id === c.from);
  if (!cls || c.fields.length === 0) return 'none';
  const ids = cls.metricIds.filter((id) => {
    const m = model.metrics.find((x) => x.id === id);
    return !!m && m.martId === c.from && m.calculated === true && c.fields.includes(m.measure.field);
  });
  if (ids.length === 0) return 'none';
  const id = ids.includes(cls.keyMetricId ?? '') ? cls.keyMetricId! : ids[0]!;
  const res = cache?.cards[c.from]?.metrics[id];
  return res && !res.error ? res.status : 'neutral';
}

interface Line extends Connector { d: string; tone: Tone }
type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };

/** Leave each box from the side that faces the other one: down/up across bands, sideways within one. */
export function curve(a: Box, b: Box): string {
  if (b.top - a.bottom > 8 || a.top - b.bottom > 8) {
    const down = b.top > a.bottom;
    const x1 = a.left + a.width / 2;
    const y1 = down ? a.bottom : a.top;
    const x2 = b.left + b.width / 2;
    const y2 = down ? b.top : b.bottom;
    const pull = Math.min(70, Math.abs(y2 - y1) / 2 + 12);
    return `M${x1} ${y1} C${x1} ${down ? y1 + pull : y1 - pull} ${x2} ${down ? y2 - pull : y2 + pull} ${x2} ${y2}`;
  }
  const right = b.left + b.width / 2 > a.left + a.width / 2;
  const x1 = right ? a.right : a.left;
  const x2 = right ? b.left : b.right;
  const y1 = a.top + a.height / 2;
  const y2 = b.top + b.height / 2;
  const pull = Math.max(30, Math.abs(x2 - x1) / 2);
  return `M${x1} ${y1} C${right ? x1 + pull : x1 - pull} ${y1} ${right ? x2 - pull : x2 + pull} ${y2} ${x2} ${y2}`;
}

export function Canvas({ model: full, cache, comparisonOn, refreshing, visibleIds = null, details, missingIds, marts, compareLabel, tools, progress = null, quality, projectId, markdown, onOpen, weekStart, onRetry }: Props) {
  const [picked, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [lines, setLines] = useState<Line[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  // One switch for the whole canvas: pressing any diff chip flips every card between % and absolute.
  const [absolute, setAbsolute] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Classes the member can't see are dropped like filtered ones; the main card stays to say so.
  const model = useMemo(
    () => {
      const m = shownModel(full, details);
      return visibleIds ? { ...m, classes: m.classes.filter((c) => visibleIds.has(c.id) || c.id === m.goal.classId) } : m;
    },
    [full, visibleIds, details],
  );
  const contexts = useMemo(() => contextsOf(model), [model]);
  const selected = useMemo(() => {
    const valid = new Set(contexts.map((x) => x.id));
    return new Set([...picked].filter((id) => valid.has(id)));
  }, [picked, contexts]);
  const layout = useMemo(() => layoutFor(model, selected), [model, selected]);
  const metricsById = useMemo(() => new Map(model.metrics.map((m) => [m.id, m])), [model]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    setSelected(next);
  };

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const base = root.getBoundingClientRect();
      const boxes = new Map<string, Box>();
      root.querySelectorAll<HTMLElement>('[data-class-id]').forEach((el) => {
        const r = el.getBoundingClientRect();
        boxes.set(el.dataset.classId as string, {
          left: r.left - base.left, right: r.right - base.left, top: r.top - base.top,
          bottom: r.bottom - base.top, width: r.width, height: r.height,
        });
      });
      const next: Line[] = [];
      for (const c of layout.connectors) {
        // Drawn the way data flows: from the referenced class into the one whose formula uses it.
        const a = boxes.get(c.to);
        const b = boxes.get(c.from);
        if (a && b) next.push({ ...c, d: curve(a, b), tone: lineTone(c, model, cache) });
      }
      setLines(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    root.querySelectorAll('[data-class-id]').forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [layout, model, cache]);

  const card = (cls: ClassNode) => (
    <div key={cls.id} className="gy-slot" onPointerEnter={() => setHover(cls.id)} onPointerLeave={() => setHover(null)}>
      <Card
        cls={cls}
        mart={marts?.get(cls.id)}
        marts={marts}
        metrics={cls.metricIds.flatMap((id) => metricsById.get(id) ?? [])}
        details={details}
        cache={cache?.cards[cls.id]}
        comparisonOn={comparisonOn}
        refreshing={refreshing}
        noAccess={!!visibleIds && !visibleIds.has(cls.id)}
        missing={!!missingIds?.has(cls.id)}
        compareLabel={compareLabel}
        absolute={absolute}
        onToggleDiff={() => setAbsolute((a) => !a)}
        quality={quality?.get(cls.martId)}
        projectId={projectId}
        markdown={markdown}
        onOpen={onOpen}
        weekStart={weekStart}
        onRetry={onRetry}
      />
    </div>
  );

  return (
    <div>
      <div className="gy-toolbar">
        <div className="gy-chips">
          <button type="button" className="gy-chip" aria-pressed={selected.size === 0} onClick={() => setSelected(new Set())}>All</button>
          {contexts.map((x) => (
            <button key={x.id} type="button" className="gy-chip" aria-pressed={selected.has(x.id)} onClick={() => toggle(x.id)}>{x.name}</button>
          ))}
        </div>
        {tools && <div className="gy-toolbar-end">{tools}</div>}
      </div>
      <div className="gy-canvas" ref={ref} data-hover={hover ?? undefined}>
        {refreshing && <LoadingBar progress={progress} />}
        <svg className="gy-wires" aria-hidden="true">
          <defs>
            {/* One marker per line colour: a marker does not inherit the stroke of the path it ends. */}
            {TONES.map((tone) => (
              <marker key={tone} id={`gy-arrow-${tone}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0.5 L7 4 L0 7.5 z" data-tone={tone} />
              </marker>
            ))}
          </defs>
          {lines.map((l) => (
            <path
              key={`${l.from}-${l.to}`}
              d={l.d}
              className={[l.join ? 'join' : 'feeds', hover && (l.from === hover || l.to === hover) ? 'lit' : ''].join(' ').trim()}
              strokeDasharray={l.dashed ? '4 4' : undefined}
              data-tone={l.tone}
              markerEnd={`url(#gy-arrow-${l.tone})`}
              data-from={l.from} data-to={l.to} data-dashed={String(l.dashed)}
            />
          ))}
        </svg>
        <div className="gy-bands">
          <section className="gy-band">
            <header className="gy-band-head">
              <span className="gy-band-icon"><Target size={16} /></span>
              <h2 className="gy-band-title">Goal</h2>
            </header>
            <div className="gy-band-main">{layout.main && card(layout.main)}</div>
          </section>
          <section className="gy-band">
            <header className="gy-band-head">
              <span className="gy-band-icon"><Network size={16} /></span>
              <h2 className="gy-band-title">Drivers</h2>
            </header>
            {layout.drivers.length > 0
              ? <div className="gy-band-grid">{layout.drivers.map(card)}</div>
              : <p className="gy-muted gy-empty">No class feeds the goal in this filter.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
