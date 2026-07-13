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
    const { container } = render(<FilterBar dashboard={emptyDashboard('d1', 'm1', 'D')} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('labels each control with the mart field (column) it controls', () => {
    render(<FilterBar dashboard={dashWithSlices()} onChange={vi.fn()} />);
    expect(screen.getByText('Date')).toBeInTheDocument();
  });

  it('only offers operators/presets sourced from filterOps.ts (never a rejected one)', () => {
    render(<FilterBar dashboard={dashWithSlices()} onChange={vi.fn()} />);
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
    render(<FilterBar dashboard={dashWithSlices()} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'this_month' } });

    expect(onChange).toHaveBeenCalledWith(
      [{ column: 'Cost', operator: 'gt', value: 100 }],
      [{ column: 'Date', operator: 'relative_date', value: { kind: 'this_month' } }],
    );
  });

  it('changing N on a "Last N days" preset reports the new N', () => {
    const onChange = vi.fn();
    render(<FilterBar dashboard={dashWithSlices()} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Date N'), { target: { value: '7' } });

    expect(onChange).toHaveBeenCalledWith(
      [{ column: 'Cost', operator: 'gt', value: 100 }],
      [{ column: 'Date', operator: 'relative_date', value: { kind: 'last_n_days', n: 7 } }],
    );
  });

  it('Reset filters restores the generated slices and clears global filters', () => {
    const onChange = vi.fn();
    const d = dashWithSlices();
    d.slices[0].value = { kind: 'this_year' };
    render(<FilterBar dashboard={d} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /reset filters/i }));

    expect(onChange).toHaveBeenCalledWith(
      [],
      [{ column: 'Date', operator: 'relative_date', value: { kind: 'last_n_days', n: 30 } }],
    );
  });
});
