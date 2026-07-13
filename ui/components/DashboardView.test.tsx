import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { DashboardView } from './DashboardView';
import * as db from '../lib/dashboards';
import * as api from '../lib/api';
import { APPLY_DEBOUNCE_MS } from '../lib/freshness';
import { emptyDashboard } from '../lib/types';
import type { Dashboard, QueryResult } from '../lib/types';

// useLayerData debounces every fetch by APPLY_DEBOUNCE_MS (1s) — give waits enough headroom to
// clear it, or the assertion races the debounce timer and fails for the wrong reason.
const past = { timeout: APPLY_DEBOUNCE_MS + 500 };

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/d/${id}`]}>
      <Routes>
        <Route path="/d/:id" element={<DashboardView />} />
      </Routes>
    </MemoryRouter>,
  );
}

function dashWithScorecard(): Dashboard {
  return {
    ...emptyDashboard('d1', 'm1', 'Sales'),
    slices: [{ column: 'Date', operator: 'relative_date', value: { kind: 'last_n_days', n: 30 } }],
    components: [
      { id: 'a', type: 'scorecard', title: 'Revenue', width: 1, height: 1, config: { metric: 'Cost', aggregation: 'SUM' } },
    ],
  };
}

const emptyResult: QueryResult = { columns: [], rows: [], truncated: false, totals: null };

describe('DashboardView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the mandatory page chrome and the dashboard name once loaded', async () => {
    vi.spyOn(db, 'getDashboard').mockResolvedValue(dashWithScorecard());
    vi.spyOn(api, 'queryDataMart').mockResolvedValue(emptyResult);

    const { container } = renderAt('d1');
    expect(await screen.findByText('Sales')).toBeInTheDocument();

    expect(container.querySelector('.dm-page')).toBeTruthy();
    expect(container.querySelector('.dm-page-header')).toBeTruthy();
    expect(container.querySelector('.dm-page-header-title')).toBeTruthy();
    expect(container.querySelector('.dm-page-content')).toBeTruthy();
    expect(container.querySelector('.dm-card')).toBeTruthy();
  });

  it('shows a not-found message when the doc does not exist', async () => {
    vi.spyOn(db, 'getDashboard').mockResolvedValue(null);
    renderAt('missing');
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });

  it('queries the mart once per component, compiled from its config + the global filters/slices', async () => {
    vi.spyOn(db, 'getDashboard').mockResolvedValue(dashWithScorecard());
    const query = vi.spyOn(api, 'queryDataMart').mockResolvedValue(emptyResult);

    renderAt('d1');
    await screen.findByText('Sales');

    await waitFor(() => expect(query).toHaveBeenCalledTimes(1), past);
    expect(query).toHaveBeenCalledWith('m1', expect.objectContaining({ fields: ['Cost'] }));
  });

  it('refetches every component when a filter changes', async () => {
    vi.spyOn(db, 'getDashboard').mockResolvedValue(dashWithScorecard());
    const query = vi.spyOn(api, 'queryDataMart').mockResolvedValue(emptyResult);

    renderAt('d1');
    await screen.findByText('Sales');
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1), past);

    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'this_month' } });

    await waitFor(() => expect(query).toHaveBeenCalledTimes(2), past);
  });

  it('surfaces the server truncated flag rather than dropping it', async () => {
    vi.spyOn(db, 'getDashboard').mockResolvedValue(dashWithScorecard());
    vi.spyOn(api, 'queryDataMart').mockResolvedValue({ ...emptyResult, rows: [[1]], truncated: true });

    renderAt('d1');
    expect(await screen.findByText(/truncated/i, {}, past)).toBeInTheDocument();
  });

  it('saves the current doc via the Save button', async () => {
    const dash = dashWithScorecard();
    vi.spyOn(db, 'getDashboard').mockResolvedValue(dash);
    vi.spyOn(api, 'queryDataMart').mockResolvedValue(emptyResult);
    const save = vi.spyOn(db, 'saveDashboard').mockResolvedValue({ ...dash, configVersion: dash.configVersion + 1 });

    renderAt('d1');
    await screen.findByText('Sales');

    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(dash));
  });
});
