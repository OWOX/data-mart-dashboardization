import { cloneElement, type ReactElement } from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TimeSeriesChart } from './TimeSeriesChart';
import type { Component, QueryResult, TimeSeriesConfig } from '../lib/types';

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

function tsComponent(overrides: Partial<TimeSeriesConfig> = {}): Component {
  return {
    id: 'c1', type: 'timeseries', title: 'Cost over time', width: 2, height: 1,
    config: { dateField: 'Day', metric: 'Cost', aggregation: 'SUM', unit: 'DAY', ...overrides },
  };
}

const singleSeries: QueryResult = {
  columns: ['Day', 'Cost | SUM'],
  rows: [['2024-01-01', 10], ['2024-01-02', 12]],
  truncated: false, totals: null,
};

describe('TimeSeriesChart — no breakdown', () => {
  it('renders one line for the bucketed date field', () => {
    const { container } = render(<TimeSeriesChart component={tsComponent()} data={singleSeries} />);
    expect(container.querySelectorAll('.recharts-line-curve').length).toBe(1);
  });

  it('renders nothing for an empty result, without crashing', () => {
    const { container } = render(<TimeSeriesChart component={tsComponent()} data={{ ...singleSeries, rows: [] }} />);
    expect(container.querySelectorAll('.recharts-line-curve').length).toBe(0);
  });

  it('degrades gracefully when the metric column is missing from `columns`', () => {
    const wrongKey: QueryResult = { columns: ['Day', 'Cost'], rows: [['2024-01-01', 10]], truncated: false, totals: null };
    const { container } = render(<TimeSeriesChart component={tsComponent()} data={wrongKey} />);
    expect(container.querySelectorAll('.recharts-line-curve').length).toBe(0);
  });

  it('renders nothing when data is null', () => {
    const { container } = render(<TimeSeriesChart component={tsComponent()} data={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('surfaces truncated results', () => {
    const { getByText } = render(<TimeSeriesChart component={tsComponent()} data={{ ...singleSeries, truncated: true }} />);
    expect(getByText(/truncated/i)).toBeInTheDocument();
  });
});

describe('TimeSeriesChart — breakdown', () => {
  it('renders one line per distinct breakdown value, colored in first-seen order', () => {
    const withBreakdown: QueryResult = {
      columns: ['Day', 'Source', 'Cost | SUM'],
      rows: [
        ['2024-01-01', 'google', 10], ['2024-01-01', 'meta', 5],
        ['2024-01-02', 'google', 12], ['2024-01-02', 'meta', 6],
      ],
      truncated: false, totals: null,
    };
    const { container } = render(
      <TimeSeriesChart component={tsComponent({ breakdown: 'Source' })} data={withBreakdown} />
    );
    const lines = container.querySelectorAll('.recharts-line-curve');
    expect(lines.length).toBe(2);
    expect(Array.from(lines).map(l => l.getAttribute('stroke'))).toEqual(['var(--chart-1)', 'var(--chart-2)']);
  });

  it('cycles the 5-color palette when breakdown has more distinct values than chart colors', () => {
    // Recharts can't draw a `<Line>` curve from a single point, so give every series two dates.
    const many: QueryResult = {
      columns: ['Day', 'Source', 'Cost | SUM'],
      rows: Array.from({ length: 7 }, (_, i) => [`src-${i}`, i]).flatMap(([src, i]) => [
        ['2024-01-01', src, Number(i) + 1],
        ['2024-01-02', src, Number(i) + 2],
      ]),
      truncated: false, totals: null,
    };
    const { container } = render(
      <TimeSeriesChart component={tsComponent({ breakdown: 'Source' })} data={many} />
    );
    const lines = container.querySelectorAll('.recharts-line-curve');
    expect(lines.length).toBe(7);
    expect(Array.from(lines).map(l => l.getAttribute('stroke'))).toEqual([
      'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)',
      'var(--chart-1)', 'var(--chart-2)',
    ]);
  });

  it('surfaces truncated results — a breakdown can hit the row cap sooner than a single series', () => {
    const withBreakdown: QueryResult = {
      columns: ['Day', 'Source', 'Cost | SUM'],
      rows: [['2024-01-01', 'google', 10]],
      truncated: true, totals: null,
    };
    const { getByText } = render(
      <TimeSeriesChart component={tsComponent({ breakdown: 'Source' })} data={withBreakdown} />
    );
    expect(getByText(/truncated/i)).toBeInTheDocument();
  });
});
