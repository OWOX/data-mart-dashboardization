import { cloneElement, type ReactElement } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PieChartView } from './PieChartView';
import type { Component, FilterRule, PieConfig, QueryResult } from '../lib/types';

// Same rationale as BarChartView.test.tsx: happy-dom has no layout engine, so recharts'
// <ResponsiveContainer> measurement always yields 0x0. Give the chart a fixed size directly.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 400, height: 300 } as Record<string, unknown>),
  };
});

function pieComponent(type: 'pie' | 'donut', overrides: Partial<PieConfig> = {}): Component {
  return {
    id: 'c1', type, title: 'Cost by source', width: 2, height: 1,
    config: { dimension: 'Source', metric: 'Cost', aggregation: 'SUM', maxCategories: 8, ...overrides },
  };
}

const data: QueryResult = {
  columns: ['Source', 'Cost | SUM'],
  rows: [['google', 30], ['meta', 20], ['tiktok', 10]],
  truncated: false, totals: null,
};

describe('PieChartView', () => {
  it('renders one slice per server row, colored in server order', () => {
    const { container } = render(<PieChartView component={pieComponent('pie')} data={data} />);
    const sectors = container.querySelectorAll('.recharts-sector');
    expect(sectors.length).toBe(3);
    expect(Array.from(sectors).map(s => s.getAttribute('fill'))).toEqual([
      'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)',
    ]);
  });

  it('cuts a hole in the middle for `donut` but not for `pie` (innerRadius)', () => {
    const pie = render(<PieChartView component={pieComponent('pie')} data={data} />);
    const donut = render(<PieChartView component={pieComponent('donut')} data={data} />);
    // A slice path with an inner radius carves the hole with a second arc ("A ...") back toward
    // the center; a full pie slice has only one arc command.
    const arcCount = (d: string | null) => (d ?? '').match(/A\s?[\d.]/g)?.length ?? 0;
    const pieArcs = Array.from(pie.container.querySelectorAll('.recharts-sector')).map(s => arcCount(s.getAttribute('d')));
    const donutArcs = Array.from(donut.container.querySelectorAll('.recharts-sector')).map(s => arcCount(s.getAttribute('d')));
    expect(pieArcs).toEqual([1, 1, 1]);
    expect(donutArcs).toEqual([2, 2, 2]);
  });

  it('degrades gracefully when the metric column is missing from `columns`', () => {
    const wrongKey: QueryResult = { columns: ['Source', 'Cost'], rows: [['google', 30]], truncated: false, totals: null };
    const { container } = render(<PieChartView component={pieComponent('pie')} data={wrongKey} />);
    expect(container.querySelectorAll('.recharts-sector').length).toBe(0);
  });

  it('renders nothing for an empty result, without crashing', () => {
    const { container } = render(<PieChartView component={pieComponent('pie')} data={{ ...data, rows: [] }} />);
    expect(container.querySelectorAll('.recharts-sector').length).toBe(0);
  });

  it('renders a single slice without crashing', () => {
    const single: QueryResult = { ...data, rows: [['google', 30]] };
    const { container } = render(<PieChartView component={pieComponent('pie')} data={single} />);
    expect(container.querySelectorAll('.recharts-sector').length).toBe(1);
  });

  it('renders nothing when data is null', () => {
    const { container } = render(<PieChartView component={pieComponent('pie')} data={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('surfaces truncated results', () => {
    const { getByText } = render(<PieChartView component={pieComponent('pie')} data={{ ...data, truncated: true }} />);
    expect(getByText(/truncated/i)).toBeInTheDocument();
  });

  // ---- Cross-filtering (Task 16) ----

  it('clicking a slice reports an `eq` cross-filter on the component dimension, never `in`', () => {
    const onSegmentFilter = vi.fn();
    const { container } = render(
      <PieChartView component={pieComponent('pie')} data={data} onSegmentFilter={onSegmentFilter} />
    );
    const sectors = container.querySelectorAll('.recharts-sector');
    fireEvent.click(sectors[0]);
    expect(onSegmentFilter).toHaveBeenCalledWith({ column: 'Source', operator: 'eq', value: 'google' });
    expect(onSegmentFilter).not.toHaveBeenCalledWith(expect.objectContaining({ operator: 'in' }));
  });

  // recharts' Pie hard-codes tabIndex=-1 on every rendered sector and manages focus itself via its
  // own arrow-key navigation (verified against the installed recharts — renderSectorsStatically in
  // polar/Pie.js) — a per-slice tabIndex/onKeyDown is silently overridden and never fires. Instead
  // every category gets a REAL <button> "chip" below the chart, independent of that internal model.

  it('is keyboard-operable: each category has a real, natively-focusable button chip that reports the same filter a click on the slice would', () => {
    const onSegmentFilter = vi.fn();
    const { getByRole } = render(
      <PieChartView component={pieComponent('donut')} data={data} onSegmentFilter={onSegmentFilter} />
    );
    const chip = getByRole('button', { name: 'meta' });
    chip.focus();
    expect(document.activeElement).toBe(chip);
    fireEvent.click(chip);
    expect(onSegmentFilter).toHaveBeenCalledWith({ column: 'Source', operator: 'eq', value: 'meta' });
  });

  it('renders one accessible chip per category, grouped under a labelled group', () => {
    const { getByRole } = render(
      <PieChartView component={pieComponent('pie')} data={data} onSegmentFilter={vi.fn()} />
    );
    const group = getByRole('group', { name: /filter by source/i });
    expect(group.querySelectorAll('button')).toHaveLength(3);
  });

  it('conveys the active cross-filter to assistive tech via aria-pressed on the chip, plus a non-color stroke marker on the slice', () => {
    const filters: FilterRule[] = [{ column: 'Source', operator: 'eq', value: 'tiktok' }];
    const { getByRole, container } = render(
      <PieChartView component={pieComponent('pie')} data={data} filters={filters} onSegmentFilter={vi.fn()} />
    );
    expect(getByRole('button', { name: 'google' }).getAttribute('aria-pressed')).toBe('false');
    expect(getByRole('button', { name: 'tiktok' }).getAttribute('aria-pressed')).toBe('true');
    const sectors = container.querySelectorAll('.recharts-sector');
    expect(sectors[2].getAttribute('stroke')).toBeTruthy();
    expect(sectors[0].getAttribute('stroke')).toBeFalsy();
  });

  it('without onSegmentFilter, no chip row is rendered — read-only rendering stays read-only', () => {
    const { queryByRole } = render(<PieChartView component={pieComponent('pie')} data={data} />);
    expect(queryByRole('group')).toBeNull();
  });
});
