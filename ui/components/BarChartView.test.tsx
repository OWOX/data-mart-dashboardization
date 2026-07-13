import { cloneElement, type ReactElement } from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BarChartView } from './BarChartView';
import type { BarConfig, Component, QueryResult } from '../lib/types';

// recharts' <ResponsiveContainer> measures its DOM node (ResizeObserver + getBoundingClientRect)
// to size its child chart; happy-dom has no layout engine, so real measurement always yields 0x0
// and recharts renders nothing. Replace it with the same clone-with-fixed-size behaviour the real
// component does internally, just skipping the measurement step — per the brief's own guidance
// ("wrap in a fixed-size div or mock ResponsiveContainer").
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 400, height: 300 } as Record<string, unknown>),
  };
});

function barComponent(overrides: Partial<BarConfig> = {}): Component {
  return {
    id: 'c1', type: 'bar', title: 'Cost by source', width: 2, height: 1,
    config: {
      dimension: 'Source', metric: 'Cost', aggregation: 'SUM',
      orientation: 'vertical', limit: 10,
      ...overrides,
    },
  };
}

const data: QueryResult = {
  columns: ['Source', 'Cost | SUM'],
  rows: [['google', 30], ['meta', 20], ['tiktok', 10]],
  truncated: false, totals: null,
};

describe('BarChartView', () => {
  it('renders one bar per server row, in server order (never re-sorted)', () => {
    const { container } = render(<BarChartView component={barComponent()} data={data} />);
    const bars = container.querySelectorAll('.recharts-rectangle');
    expect(bars.length).toBe(3);
    // Cells are colored by row index (COLORS[i % 5]) — a stable, order-derived fingerprint that
    // lets us assert the DOM wasn't silently re-sorted without depending on recharts' internal
    // pixel geometry.
    const fills = Array.from(bars).map(b => b.getAttribute('fill'));
    expect(fills).toEqual(['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)']);
  });

  it('renders nothing (no crash) for an empty result', () => {
    const { container } = render(
      <BarChartView component={barComponent()} data={{ ...data, rows: [] }} />
    );
    expect(container.querySelectorAll('.recharts-rectangle').length).toBe(0);
  });

  it('degrades gracefully — never crashes — when the metric column is missing from `columns`', () => {
    // Simulates a hand-rolled/incorrect key: aggLabel('Cost','SUM') would be 'Cost | SUM', which
    // is absent here, so toPoints must return [] rather than the component throwing.
    const wrongKey: QueryResult = { columns: ['Source', 'Cost'], rows: [['google', 30]], truncated: false, totals: null };
    const { container } = render(<BarChartView component={barComponent()} data={wrongKey} />);
    expect(container.querySelectorAll('.recharts-rectangle').length).toBe(0);
  });

  it('renders a single data point without crashing', () => {
    const single: QueryResult = { ...data, rows: [['google', 30]] };
    const { container } = render(<BarChartView component={barComponent()} data={single} />);
    expect(container.querySelectorAll('.recharts-rectangle').length).toBe(1);
  });

  it('coerces a null metric to 0 without crashing (recharts renders a zero-height bar as an empty layer, not a path)', () => {
    const withNull: QueryResult = { ...data, rows: [['google', null], ['meta', 20]] };
    const { container } = render(<BarChartView component={barComponent()} data={withNull} />);
    // Two `<g class="recharts-bar-rectangle">` layers exist (one per row); only the non-zero one
    // gets an actual `<path>` — recharts doesn't draw a zero-height rectangle. Asserting the wrapper
    // count catches a crash/dropped-row regression without depending on that internal skip.
    expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBe(2);
    expect(container.querySelectorAll('.recharts-rectangle').length).toBe(1);
  });

  it('cycles the 5-color palette when there are more categories than colors', () => {
    const many: QueryResult = {
      columns: ['Source', 'Cost | SUM'],
      rows: Array.from({ length: 7 }, (_, i) => [`src-${i}`, i + 1]),
      truncated: false, totals: null,
    };
    const { container } = render(<BarChartView component={barComponent()} data={many} />);
    const fills = Array.from(container.querySelectorAll('.recharts-rectangle')).map(b => b.getAttribute('fill'));
    expect(fills).toEqual([
      'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)',
      'var(--chart-1)', 'var(--chart-2)',
    ]);
  });

  it('renders nothing when data is null', () => {
    const { container } = render(<BarChartView component={barComponent()} data={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('surfaces truncated results instead of silently looking complete', () => {
    const { getByText } = render(
      <BarChartView component={barComponent()} data={{ ...data, truncated: true }} />
    );
    expect(getByText(/truncated/i)).toBeInTheDocument();
  });
});
