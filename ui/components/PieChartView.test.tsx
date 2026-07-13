import { cloneElement, type ReactElement } from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PieChartView } from './PieChartView';
import type { Component, PieConfig, QueryResult } from '../lib/types';

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
});
