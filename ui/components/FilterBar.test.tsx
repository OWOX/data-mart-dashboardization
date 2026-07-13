import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterBar } from './FilterBar';
import { emptyDashboard } from '../lib/types';
import type { Dashboard } from '../lib/types';

function dashWithSlices(): Dashboard {
  return {
    ...emptyDashboard('d1', 'm1', 'D'),
    slices: [{ column: 'Date', operator: 'relative_date', value: { kind: 'last_n_days', n: 30 } }],
    filters: [{ column: 'Cost', operator: 'gt', value: 100 }],
  };
}

describe('FilterBar', () => {
  it('renders nothing when the dashboard has no date slices', () => {
    const { container } = render(
      <FilterBar dashboard={emptyDashboard('d1', 'm1', 'D')} filters={[]} onChange={vi.fn()} onResetAll={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('labels each control with the mart field (column) it controls', () => {
    const d = dashWithSlices();
    render(<FilterBar dashboard={d} filters={d.filters} onChange={vi.fn()} onResetAll={vi.fn()} />);
    expect(screen.getByText('Date')).toBeInTheDocument();
  });

  it('only offers operators/presets sourced from filterOps.ts (never a rejected one)', () => {
    const d = dashWithSlices();
    render(<FilterBar dashboard={d} filters={d.filters} onChange={vi.fn()} onResetAll={vi.fn()} />);
    const select = screen.getByLabelText('Date range') as HTMLSelectElement;
    const options = [...select.options].map(o => o.value);
    expect(options).toEqual([
      'today', 'yesterday', 'last_n_days', 'this_month', 'last_month', 'last_n_months', 'this_year',
    ]);
    expect(options).not.toContain('this_week');
    expect(options).not.toContain('in_next_n_days');
  });

  it('changing the preset reports the updated slice, keeping other slices/filters untouched', () => {
    const onChange = vi.fn();
    const d = dashWithSlices();
    render(<FilterBar dashboard={d} filters={d.filters} onChange={onChange} onResetAll={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'this_month' } });

    expect(onChange).toHaveBeenCalledWith(
      [{ column: 'Cost', operator: 'gt', value: 100 }],
      [{ column: 'Date', operator: 'relative_date', value: { kind: 'this_month' } }],
    );
  });

  it('changing N on a "Last N days" preset reports the new N', () => {
    const onChange = vi.fn();
    const d = dashWithSlices();
    render(<FilterBar dashboard={d} filters={d.filters} onChange={onChange} onResetAll={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Date N'), { target: { value: '7' } });

    expect(onChange).toHaveBeenCalledWith(
      [{ column: 'Cost', operator: 'gt', value: 100 }],
      [{ column: 'Date', operator: 'relative_date', value: { kind: 'last_n_days', n: 7 } }],
    );
  });

  // Task 20/M7: "Reset filters" no longer computes anything itself — `FilterBar` has no way to
  // reach the ephemeral `crossFilters` state that now lives in `DashboardView`, so the button just
  // invokes the `onResetAll` prop. What "reset" actually clears (persisted filters AND any active
  // cross-filter) is `DashboardView`'s job, covered by the DashboardView.test.tsx integration tests.
  it('Reset filters clears global/cross filters but leaves the current date slice value untouched', () => {
    const onResetAll = vi.fn();
    const d = dashWithSlices();
    d.slices[0].value = { kind: 'this_year' };
    render(<FilterBar dashboard={d} filters={d.filters} onChange={vi.fn()} onResetAll={onResetAll} />);

    fireEvent.click(screen.getByRole('button', { name: /reset filters/i }));

    expect(onResetAll).toHaveBeenCalled();
  });

  // ---- Task 16: cross-filtering visibility — a filter must never be invisible/unreachable ----

  it('renders (with a Reset filters button) when there are cross-filters but no date slices, so an active filter is never invisible', () => {
    const d = { ...emptyDashboard('d1', 'm1', 'D'), filters: [{ column: 'Source', operator: 'eq', value: 'google' }] };
    render(<FilterBar dashboard={d} filters={d.filters} onChange={vi.fn()} onResetAll={vi.fn()} />);
    expect(screen.getByRole('button', { name: /reset filters/i })).toBeInTheDocument();
    expect(screen.getByText(/Source = google/)).toBeInTheDocument();
  });

  it('Reset filters (with no date slices at all) clears the cross-filter and reports empty slices', () => {
    const onResetAll = vi.fn();
    const d = { ...emptyDashboard('d1', 'm1', 'D'), filters: [{ column: 'Source', operator: 'eq', value: 'google' }] };
    render(<FilterBar dashboard={d} filters={d.filters} onChange={vi.fn()} onResetAll={onResetAll} />);

    fireEvent.click(screen.getByRole('button', { name: /reset filters/i }));

    expect(onResetAll).toHaveBeenCalled();
  });

  it('surfaces every active filter/cross-filter as readable text, not merely via a control state', () => {
    const d: Dashboard = {
      ...dashWithSlices(),
      filters: [
        { column: 'Cost', operator: 'gt', value: 100 },
        { column: 'Source', operator: 'eq', value: 'google' },
      ],
    };
    render(<FilterBar dashboard={d} filters={d.filters} onChange={vi.fn()} onResetAll={vi.fn()} />);
    expect(screen.getByText(/Cost = 100/)).toBeInTheDocument();
    expect(screen.getByText(/Source = google/)).toBeInTheDocument();
  });
});
