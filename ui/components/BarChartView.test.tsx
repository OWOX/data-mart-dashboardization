import { cloneElement, type ReactElement } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BarChartView } from './BarChartView';
import type { BarConfig, Component, FilterRule, QueryResult } from '../lib/types';

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

  // ---- Cross-filtering (Task 16): clicking a bar (or its accessible chip) reports an `eq` filter,
  // never `in` (the query service rejects `in`/`not_in` — see filterOps.ts) ----

  it('clicking a bar reports an `eq` cross-filter on the component dimension, never `in`', () => {
    const onSegmentFilter = vi.fn();
    const { container } = render(
      <BarChartView component={barComponent()} data={data} onSegmentFilter={onSegmentFilter} />
    );
    const bars = container.querySelectorAll('.recharts-rectangle');
    fireEvent.click(bars[0]);
    expect(onSegmentFilter).toHaveBeenCalledWith({ column: 'Source', operator: 'eq', value: 'google' });
    expect(onSegmentFilter).not.toHaveBeenCalledWith(expect.objectContaining({ operator: 'in' }));
  });

  // recharts' bar shapes are plain SVG paths with no native keyboard semantics, and hand-rolling
  // tabIndex/onKeyDown per bar is fragile against the library's own internals (see PieChartView,
  // where the sibling Pie component hard-codes tabIndex=-1 on every sector). Instead every category
  // gets a REAL <button> "chip" below the chart — natively Tab-reachable and screen-reader friendly
  // regardless of recharts' internal focus model.

  it('is keyboard-operable: each category has a real, natively-focusable button chip that reports the same filter a click on the bar would', () => {
    const onSegmentFilter = vi.fn();
    const { getByRole } = render(
      <BarChartView component={barComponent()} data={data} onSegmentFilter={onSegmentFilter} />
    );
    const chip = getByRole('button', { name: 'meta' });
    chip.focus();
    expect(document.activeElement).toBe(chip);
    fireEvent.click(chip);
    expect(onSegmentFilter).toHaveBeenCalledWith({ column: 'Source', operator: 'eq', value: 'meta' });
  });

  it('renders one accessible chip per category, grouped under a labelled group', () => {
    const { getByRole } = render(
      <BarChartView component={barComponent()} data={data} onSegmentFilter={vi.fn()} />
    );
    const group = getByRole('group', { name: /filter by source/i });
    const chips = group.querySelectorAll('button');
    expect(chips).toHaveLength(3);
  });

  it('conveys the active cross-filter to assistive tech via aria-pressed on the chip (not by color alone)', () => {
    const filters: FilterRule[] = [{ column: 'Source', operator: 'eq', value: 'meta' }];
    const { getByRole, container } = render(
      <BarChartView component={barComponent()} data={data} filters={filters} onSegmentFilter={vi.fn()} />
    );
    expect(getByRole('button', { name: 'google' }).getAttribute('aria-pressed')).toBe('false');
    expect(getByRole('button', { name: 'meta' }).getAttribute('aria-pressed')).toBe('true');
    expect(getByRole('button', { name: 'tiktok' }).getAttribute('aria-pressed')).toBe('false');
    // Beyond aria-pressed, the active chart segment also gets a non-color visual marker (a stroke
    // ring) so the distinction isn't conveyed by fill color alone.
    const bars = container.querySelectorAll('.recharts-rectangle');
    expect(bars[1].getAttribute('stroke')).toBeTruthy();
    expect(bars[0].getAttribute('stroke')).toBeFalsy();
  });

  it('without onSegmentFilter, no chip row is rendered — read-only rendering stays read-only', () => {
    const { queryByRole } = render(<BarChartView component={barComponent()} data={data} />);
    expect(queryByRole('group')).toBeNull();
  });

  // ---- Cross-filtering on a NON-STRING dimension: a numeric column (rating, day_of_week,
  // store_id, ...) is a legal dimension — ComponentEditor.tsx only requires role === 'dimension'.
  // toPoints stringifies for display (`label`), but sending that string as the `eq` filter value
  // against a numeric server column can silently zero-match, showing an empty/zero dashboard that
  // LOOKS correctly filtered. The fix: emit() must send the point's raw (uncoerced) value. ----

  const numericComponent = (): Component => ({
    id: 'c1', type: 'bar', title: 'Cost by rating', width: 2, height: 1,
    config: {
      dimension: 'Rating', metric: 'Cost', aggregation: 'SUM',
      orientation: 'vertical', limit: 10,
    },
  });

  const numericData: QueryResult = {
    columns: ['Rating', 'Cost | SUM'],
    rows: [[5, 30], [4, 20], [3, 10]],
    truncated: false, totals: null,
  };

  it('clicking a bar on a NUMERIC dimension emits the raw number as the filter value, not its stringified label', () => {
    const onSegmentFilter = vi.fn();
    const { container } = render(
      <BarChartView component={numericComponent()} data={numericData} onSegmentFilter={onSegmentFilter} />
    );
    const bars = container.querySelectorAll('.recharts-rectangle');
    fireEvent.click(bars[0]);
    expect(onSegmentFilter).toHaveBeenCalledWith({ column: 'Rating', operator: 'eq', value: 5 });
    expect(onSegmentFilter.mock.calls[0][0].value).not.toBe('5');
    expect(typeof onSegmentFilter.mock.calls[0][0].value).toBe('number');
  });

  it('clicking the accessible chip for a numeric dimension also emits the raw number, not a string — and still DISPLAYS the stringified label', () => {
    const onSegmentFilter = vi.fn();
    const { getByRole } = render(
      <BarChartView component={numericComponent()} data={numericData} onSegmentFilter={onSegmentFilter} />
    );
    const chip = getByRole('button', { name: '4' });
    expect(chip.textContent).toBe('4');
    fireEvent.click(chip);
    expect(onSegmentFilter).toHaveBeenCalledWith({ column: 'Rating', operator: 'eq', value: 4 });
  });

  it('a STRING dimension still emits the string value — no regression', () => {
    const onSegmentFilter = vi.fn();
    const { container } = render(
      <BarChartView component={barComponent()} data={data} onSegmentFilter={onSegmentFilter} />
    );
    fireEvent.click(container.querySelectorAll('.recharts-rectangle')[1]);
    expect(onSegmentFilter).toHaveBeenCalledWith({ column: 'Source', operator: 'eq', value: 'meta' });
    expect(typeof onSegmentFilter.mock.calls[0][0].value).toBe('string');
  });
});
