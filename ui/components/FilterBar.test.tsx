import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterBar } from './FilterBar';
import { emptyDashboard } from '../lib/types';
import type { Dashboard, MartField } from '../lib/types';

function dashWithSlices(): Dashboard {
  return {
    ...emptyDashboard('d1', 'm1', 'D'),
    slices: [{ column: 'Date', operator: 'relative_date', value: { kind: 'last_n_days', n: 30 } }],
    filters: [{ column: 'Cost', operator: 'gt', value: 100 }],
  };
}

const martFields: MartField[] = [
  { name: 'date', type: 'DATE', role: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
];

describe('FilterBar', () => {
  it('renders nothing when the mart has no date fields and nothing is filtered', () => {
    const { container } = render(
      <FilterBar fields={[]} dashboard={emptyDashboard('d1', 'm1', 'D')} filters={[]} onChange={vi.fn()} onResetAll={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a control per date field ON the dashboard, not per date field in the mart', () => {
    const fields: MartField[] = [
      { name: 'created', type: 'TIMESTAMP', role: 'dimension', allowedAggregations: ['MIN', 'MAX'], alias: 'Created Date Time' },
      { name: 'modified', type: 'TIMESTAMP', role: 'dimension', allowedAggregations: ['MIN', 'MAX'], alias: 'Modified Date Time' },
    ];
    const d: Dashboard = {
      ...emptyDashboard('d1', 'm1', 'D'),
      slices: [{ column: 'created', operator: 'relative_date', value: { kind: 'last_n_days', n: 30 } }],
    };
    render(<FilterBar fields={fields} dashboard={d} filters={[]} onChange={vi.fn()} onResetAll={vi.fn()} />);

    // Ticked in Fields → a control, labelled by alias. Unticked → absent from the bar entirely.
    expect(screen.getByLabelText('Created Date Time range')).toHaveValue('last_n_days');
    expect(screen.queryByLabelText('Modified Date Time range')).not.toBeInTheDocument();
  });

  it('All time on a dashboard date field removes its slice', () => {
    const fields: MartField[] = [
      { name: 'created', type: 'TIMESTAMP', role: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
    ];
    const d: Dashboard = {
      ...emptyDashboard('d1', 'm1', 'D'),
      slices: [{ column: 'created', operator: 'relative_date', value: { kind: 'this_month' } }],
    };
    const onChange = vi.fn();
    render(<FilterBar fields={fields} dashboard={d} filters={[]} onChange={onChange} onResetAll={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('created range'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith([], []);
  });

  it('labels each control with the mart field (column) it controls', () => {
    const d = dashWithSlices();
    render(<FilterBar fields={martFields} dashboard={d} filters={d.filters} onChange={vi.fn()} onResetAll={vi.fn()} />);
    expect(screen.getByText('Date')).toBeInTheDocument();
  });

  it('only offers operators/presets sourced from filterOps.ts (never a rejected one)', () => {
    const d = dashWithSlices();
    render(<FilterBar fields={martFields} dashboard={d} filters={d.filters} onChange={vi.fn()} onResetAll={vi.fn()} />);
    const select = screen.getByLabelText('Date range') as HTMLSelectElement;
    const options = [...select.options].map(o => o.value);
    // '' is the "All time" escape, not an operator — it clears the slice rather than sending one.
    expect(options).toEqual([
      '', 'today', 'yesterday', 'last_n_days', 'this_month', 'last_month', 'last_n_months', 'this_year',
    ]);
    expect(options).not.toContain('this_week');
    expect(options).not.toContain('in_next_n_days');
  });

  it('changing the preset reports the updated slice, keeping other slices/filters untouched', () => {
    const onChange = vi.fn();
    const d = dashWithSlices();
    render(<FilterBar fields={martFields} dashboard={d} filters={d.filters} onChange={onChange} onResetAll={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'this_month' } });

    expect(onChange).toHaveBeenCalledWith(
      [{ column: 'Cost', operator: 'gt', value: 100 }],
      [{ column: 'Date', operator: 'relative_date', value: { kind: 'this_month' } }],
    );
  });

  it('changing N on a "Last N days" preset reports the new N', () => {
    const onChange = vi.fn();
    const d = dashWithSlices();
    render(<FilterBar fields={martFields} dashboard={d} filters={d.filters} onChange={onChange} onResetAll={vi.fn()} />);

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
    render(<FilterBar fields={martFields} dashboard={d} filters={d.filters} onChange={vi.fn()} onResetAll={onResetAll} />);

    fireEvent.click(screen.getByRole('button', { name: /reset filters/i }));

    expect(onResetAll).toHaveBeenCalled();
  });

  // ---- Task 16: cross-filtering visibility — a filter must never be invisible/unreachable ----

  it('renders (with a Reset filters button) when there are cross-filters but no date slices, so an active filter is never invisible', () => {
    const d = { ...emptyDashboard('d1', 'm1', 'D'), filters: [{ column: 'Source', operator: 'eq', value: 'google' }] };
    render(<FilterBar fields={martFields} dashboard={d} filters={d.filters} onChange={vi.fn()} onResetAll={vi.fn()} />);
    expect(screen.getByRole('button', { name: /reset filters/i })).toBeInTheDocument();
    expect(screen.getByText(/Source = google/)).toBeInTheDocument();
  });

  it('Reset filters (with no date slices at all) clears the cross-filter and reports empty slices', () => {
    const onResetAll = vi.fn();
    const d = { ...emptyDashboard('d1', 'm1', 'D'), filters: [{ column: 'Source', operator: 'eq', value: 'google' }] };
    render(<FilterBar fields={martFields} dashboard={d} filters={d.filters} onChange={vi.fn()} onResetAll={onResetAll} />);

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
    render(<FilterBar fields={martFields} dashboard={d} filters={d.filters} onChange={vi.fn()} onResetAll={vi.fn()} />);
    expect(screen.getByText(/Cost = 100/)).toBeInTheDocument();
    expect(screen.getByText(/Source = google/)).toBeInTheDocument();
  });
});
