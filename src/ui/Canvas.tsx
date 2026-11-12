import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Network, Target } from 'lucide-react';
import type { CacheDoc, ClassNode, Model, Status, WeekStart } from '../types';
import type { MartDetail } from '../owox/sources';
import type { QualitySummary } from '../owox/quality';
import type { MarkdownHtml } from '../lib/markdown';
import { shownModel } from '../model/shown';
import { Card, type MartInfo } from './Card';
import { LoadingBar, type LoadingProgress } from './LoadingBar';
import { OntologyCard } from './OntologyCard';
import { contextsOf, layoutFor, ontologyLayout, type Connector } from './layout';

/** Where each core card sits on the 3x3 grid (column, row; the goal is 2,2): top, right, bottom, left, then the corners. */
const SPOTS: ReadonlyArray<readonly [number, number]> = [[2, 1], [3, 2], [2, 3], [1, 2], [3, 1], [3, 3], [1, 3], [1, 1]];

interface Props {
  /** 'ontology' draws names only (goal and core classes); 'flow' draws the numbers. */
  mode: 'ontology' | 'flow';
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

/** The orbit grid's gap in px. Keep in sync with `gap: 48px` on `.gy-orbit` in styles.css. */
export const ORBIT_GAP = 48;

/**
 * A line between two non-goal orbit cards, routed through the gutters around the goal so it crosses no card.
 * Spots are derived from the boxes' positions relative to the goal; R is the goal box grown by half the gap.
 */
export function orbitRoute(a: Box, b: Box, goal: Box): string {
  const h = ORBIT_GAP / 2;
  const R = { left: goal.left - h, right: goal.right + h, top: goal.top - h, bottom: goal.bottom + h };
  const gx = goal.left + goal.width / 2, gy = goal.top + goal.height / 2;
  const W = R.right - R.left, H = R.bottom - R.top, P = 2 * (W + H);
  const corners = [{ x: R.left, y: R.top }, { x: R.right, y: R.top }, { x: R.right, y: R.bottom }, { x: R.left, y: R.bottom }];
  const cornerAt = [0, W, W + H, 2 * W + H];
  // Where a card meets R (port) and where it touches the line (edge), by the side of the goal it sits on.
  const spot = (r: Box) => {
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const col = cx < goal.left ? -1 : cx > goal.right ? 1 : 0;
    const row = cy < goal.top ? -1 : cy > goal.bottom ? 1 : 0;
    const port = { x: col < 0 ? R.left : col > 0 ? R.right : gx, y: row < 0 ? R.top : row > 0 ? R.bottom : gy };
    const edge = {
      x: col === 0 ? gx : col < 0 ? r.right : r.left,
      y: row === 0 ? gy : row < 0 ? r.bottom : r.top,
    };
    return { port, edge };
  };
  const along = (q: { x: number; y: number }) => {
    if (q.y === R.top) return q.x - R.left;
    if (q.x === R.right) return W + (q.y - R.top);
    if (q.y === R.bottom) return W + H + (R.right - q.x);
    return 2 * W + H + (R.bottom - q.y);
  };
  const sa = spot(a), sb = spot(b);
  const pa = along(sa.port), pb = along(sb.port);
  const fwd = (pb - pa + P) % P;
  const clockwise = fwd <= P - fwd;
  const turns: { x: number; y: number }[] = [];
  const order = clockwise ? [0, 1, 2, 3] : [3, 2, 1, 0];
  const span = clockwise ? fwd : P - fwd;
  // Corners strictly between the two ports, in travel order.
  const between = order
    .map((k) => ({ k, d: clockwise ? (cornerAt[k]! - pa + P) % P : (pa - cornerAt[k]! + P) % P }))
    .filter((c) => c.d > 0 && c.d < span)
    .sort((x, y) => x.d - y.d);
  for (const c of between) turns.push(corners[c.k]!);
  const pts = [sa.edge, sa.port, ...turns, sb.port, sb.edge].filter((q, i, all) => i === 0 || q.x !== all[i - 1]!.x || q.y !== all[i - 1]!.y);
  const r = 8;
  let d = `M${pts[0]!.x} ${pts[0]!.y}`;
  for (let k = 1; k < pts.length; k++) {
    const v = pts[k]!;
    const prev = pts[k - 1]!;
    const next = pts[k + 1];
    if (!next) { d += ` L${v.x} ${v.y}`; break; }
    const l1 = Math.hypot(prev.x - v.x, prev.y - v.y), l2 = Math.hypot(next.x - v.x, next.y - v.y);
    const t = Math.min(r, l1 / 2, l2 / 2);
    d += ` L${v.x + ((prev.x - v.x) / l1) * t} ${v.y + ((prev.y - v.y) / l1) * t} Q${v.x} ${v.y} ${v.x + ((next.x - v.x) / l2) * t} ${v.y + ((next.y - v.y) / l2) * t}`;
  }
  return d;
}

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

export function Canvas({ mode, model: full, cache, comparisonOn, refreshing, visibleIds = null, details, missingIds, marts, compareLabel, tools, progress = null, quality, projectId, markdown, onOpen, weekStart, onRetry }: Props) {
  const [picked, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [lines, setLines] = useState<Line[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  // One switch for the whole canvas: pressing any diff chip flips every card between % and absolute.
  const [absolute, setAbsolute] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Every member sees the same classes; the ones whose Data Mart they can't read render as no-access cards.
  const model = useMemo(() => shownModel(full, details), [full, details]);
  // The ontology view lists only the contexts a core class belongs to.
  const contexts = useMemo(
    () => contextsOf(mode === 'ontology' ? { ...model, classes: model.classes.filter((c) => c.core) } : model),
    [model, mode],
  );
  const selected = useMemo(() => {
    const valid = new Set(contexts.map((x) => x.id));
    return new Set([...picked].filter((id) => valid.has(id)));
  }, [picked, contexts]);
  const flow = useMemo(() => layoutFor(model, selected), [model, selected]);
  const onto = useMemo(() => ontologyLayout(model, selected), [model, selected]);
  const layout = mode === 'ontology' ? onto : flow;
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
      const goalBox = mode === 'ontology' && onto.goal ? boxes.get(onto.goal.id) : undefined;
      // Stacked (narrow) orbit: every card sits over the goal's column, so plain curves do.
      const stacked = !!goalBox && [...boxes.values()].every((x) => x.left + x.width / 2 >= goalBox.left && x.left + x.width / 2 <= goalBox.right);
      const next: Line[] = [];
      for (const c of layout.connectors) {
        // Drawn the way data flows: from the referenced class into the one whose formula uses it.
        const a = boxes.get(c.to);
        const b = boxes.get(c.from);
        if (a && b) next.push({ ...c, d: goalBox && c.join && !stacked ? orbitRoute(a, b, goalBox) : curve(a, b), tone: mode === 'ontology' ? 'none' : lineTone(c, model, cache) });
      }
      setLines(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    root.querySelectorAll('[data-class-id]').forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [layout, onto, model, cache, mode]);

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
        {mode === 'flow' && refreshing && <LoadingBar progress={progress} />}
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
        {mode === 'ontology' ? (
          <ul className="gy-orbit" data-count={onto.core.length}>
            {onto.goal && (
              <li className="gy-orbit-cell" style={{ gridColumn: 2, gridRow: 2 }}>
                <OntologyCard cls={onto.goal} mart={marts?.get(onto.goal.id)} goal />
              </li>
            )}
            {onto.core.slice(0, SPOTS.length).map((c, i) => (
              <li key={c.id} className="gy-orbit-cell" style={{ gridColumn: SPOTS[i]![0], gridRow: SPOTS[i]![1] }}>
                <OntologyCard cls={c} mart={marts?.get(c.id)} goal={false} />
              </li>
            ))}
            {onto.core.length === 0 && <li className="gy-muted gy-empty gy-orbit-empty">No core classes yet. An admin can set them in Settings, Checkup.</li>}
          </ul>
        ) : (
        <div className="gy-bands">
          <section className="gy-band">
            <header className="gy-band-head">
              <span className="gy-band-icon"><Target size={16} /></span>
              <h2 className="gy-band-title">Goal</h2>
            </header>
            <div className="gy-band-main">{flow.main && card(flow.main)}</div>
          </section>
          <section className="gy-band">
            <header className="gy-band-head">
              <span className="gy-band-icon"><Network size={16} /></span>
              <h2 className="gy-band-title">Drivers</h2>
            </header>
            {flow.drivers.length > 0
              ? <div className="gy-band-grid">{flow.drivers.map(card)}</div>
              : <p className="gy-muted gy-empty">No class feeds the goal in this filter.</p>}
          </section>
        </div>
        )}
      </div>
    </div>
  );
}
