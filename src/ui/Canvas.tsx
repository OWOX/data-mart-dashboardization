import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CacheDoc, Model } from '../types';
import { Card } from './Card';
import { contextsOf, layoutFor } from './layout';

interface Props {
  model: Model;
  cache: CacheDoc | null;
  comparisonOn: boolean;
  refreshing: boolean;
  onRetry: () => void;
}

interface Line { from: string; to: string; dashed: boolean; x1: number; y1: number; x2: number; y2: number }

export function Canvas({ model, cache, comparisonOn, refreshing, onRetry }: Props) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [lines, setLines] = useState<Line[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => layoutFor(model, selected), [model, selected]);
  const contexts = useMemo(() => contextsOf(model), [model]);
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
      const cards = new Map<string, DOMRect>();
      root.querySelectorAll<HTMLElement>('[data-class-id]').forEach((el) => {
        cards.set(el.dataset.classId as string, el.getBoundingClientRect());
      });
      const next: Line[] = [];
      for (const c of layout.connectors) {
        const a = cards.get(c.from);
        const b = cards.get(c.to);
        if (!a || !b) continue;
        next.push({
          ...c,
          x1: a.left + a.width / 2 - base.left,
          y1: a.bottom - base.top,
          x2: b.left + b.width / 2 - base.left,
          y2: b.top - base.top,
        });
      }
      setLines(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    root.querySelectorAll('[data-class-id]').forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [layout]);

  return (
    <div>
      <div className="gy-chips">
        <button type="button" className="gy-chip" aria-pressed={selected.size === 0} onClick={() => setSelected(new Set())}>All</button>
        {contexts.map((x) => (
          <button key={x.id} type="button" className="gy-chip" aria-pressed={selected.has(x.id)} onClick={() => toggle(x.id)}>{x.name}</button>
        ))}
      </div>
      <div className="gy-canvas" ref={ref}>
        {refreshing && <div className="gy-progress" role="progressbar" aria-label="Refreshing" />}
        <svg className="gy-links" aria-hidden="true">
          {lines.map((l) => (
            <line
              key={`${l.from}-${l.to}`}
              x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
              stroke="var(--border-hover)" strokeWidth={1}
              strokeDasharray={l.dashed ? '4 4' : undefined}
              data-from={l.from} data-to={l.to} data-dashed={String(l.dashed)}
            />
          ))}
        </svg>
        {layout.rows.map((row, i) => (
          <div className="gy-row" key={i}>
            {row.map((cls) => (
              <Card
                key={cls.id}
                cls={cls}
                metrics={cls.metricIds.flatMap((id) => metricsById.get(id) ?? [])}
                cache={cache?.cards[cls.id]}
                comparisonOn={comparisonOn}
                refreshing={refreshing}
                onRetry={onRetry}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
