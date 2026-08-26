import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { DashboardView } from './DashboardView';
import * as db from '../lib/dashboards';
import * as api from '../lib/api';
import { APPLY_DEBOUNCE_MS } from '../lib/freshness';
import { FIELDS_APPLY_DELAY_MS } from './FieldsPanel';
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

/** A bar component + a scorecard, so a cross-filter clicked on the bar can be checked as reaching
 * BOTH components' compiled queries (filters are global — see `Dashboard.filters` in types.ts). */
function dashWithBar(): Dashboard {
  return {
    ...emptyDashboard('d1', 'm1', 'Sales'),
    slices: [{ column: 'Date', operator: 'relative_date', value: { kind: 'last_n_days', n: 30 } }],
    components: [
      {
        id: 'a', type: 'bar', title: 'Cost by source', width: 3, height: 2,
        config: { dimension: 'Source', metric: 'Cost', aggregation: 'SUM', orientation: 'vertical', limit: 10 },
      },
      { id: 'b', type: 'scorecard', title: 'Revenue', width: 1, height: 1, config: { metric: 'Cost', aggregation: 'SUM' } },
    ],
  };
}

const barResult: QueryResult = {
  columns: ['Source', 'Cost | SUM'],
  rows: [['google', 30], ['meta', 20]],
  truncated: false, totals: null,
};

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

  describe('dashboard ⋯ menu', () => {
    const martFields: import('../lib/types').MartField[] = [
      { name: 'id', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT_DISTINCT'], isPrimaryKey: true },
      { name: 'Date', type: 'DATE', role: 'dimension', allowedAggregations: ['MIN', 'MAX'], alias: 'Event Date' },
      { name: 'Cost', type: 'FLOAT', role: 'metric', allowedAggregations: ['SUM'] },
      { name: 'Source', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT_DISTINCT'], alias: 'Traffic Source' },
    ];

    async function openMenu() {
      vi.spyOn(api, 'getMartFields').mockResolvedValue(martFields);
      vi.spyOn(api, 'getAllFields').mockResolvedValue(martFields);
      renderAt('d1');
      await screen.findByText('Sales');
      fireEvent.click(screen.getByRole('button', { name: /dashboard actions/i }));
    }

    beforeEach(() => {
      vi.spyOn(db, 'getDashboard').mockResolvedValue(dashWithScorecard());
      vi.spyOn(api, 'queryDataMart').mockResolvedValue(emptyResult);
      vi.spyOn(db, 'saveDashboard').mockImplementation(async d => d);
    });

    it('offers every dashboard-wide action', async () => {
      await openMenu();
      for (const name of ['Fields', 'Slicers', 'Refresh', 'Duplicate', 'Layout', 'Open Data Mart', 'Delete']) {
        expect(screen.getByRole('menuitem', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
      }

      // Layout is a submenu: Edit and Restore live under it.
      fireEvent.click(screen.getByRole('menuitem', { name: /^Layout/ }));
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Restore' })).toBeInTheDocument();
    });

    it('Refresh refetches every component without editing the document', async () => {
      await openMenu();
      const query = vi.mocked(api.queryDataMart);
      await waitFor(() => expect(query).toHaveBeenCalledTimes(1), past);

      fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh' }));

      await waitFor(() => expect(query).toHaveBeenCalledTimes(2), past);
      expect(db.saveDashboard).not.toHaveBeenCalled();
    });

    it('Duplicate opens the copy, not the original', async () => {
      const copy = { ...dashWithScorecard(), id: 'd2', name: 'Sales (copy)' };
      vi.spyOn(db, 'duplicateDashboard').mockResolvedValue(copy);
      await openMenu();

      fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));

      await waitFor(() => expect(db.getDashboard).toHaveBeenCalledWith('d2'), past);
    });

    it('Delete asks first, says it cannot be undone, and only then deletes', async () => {
      const del = vi.spyOn(db, 'deleteDashboard').mockResolvedValue(undefined);
      await openMenu();

      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
      expect(await screen.findByText(/cannot be undone/i)).toBeInTheDocument();
      expect(del).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(del).toHaveBeenCalledWith('d1'), past);
    });

    it('Delete can be cancelled', async () => {
      const del = vi.spyOn(db, 'deleteDashboard').mockResolvedValue(undefined);
      await openMenu();

      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

      expect(screen.queryByText(/cannot be undone/i)).not.toBeInTheDocument();
      expect(del).not.toHaveBeenCalled();
    });

    it('Fields groups the mart schema and pre-ticks what the dashboard already uses', async () => {
      await openMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Fields' }));

      expect(await screen.findByText('Date Ranges')).toBeInTheDocument();
      expect(screen.getByText('Metrics')).toBeInTheDocument();
      expect(screen.getByText('Dimensions')).toBeInTheDocument();
      // The primary key shows under its product name, not as "id".
      expect(screen.getByRole('checkbox', { name: 'Unique Count' })).not.toBeChecked();
      // dashWithScorecard() slices on Date and measures Cost.
      // Labelled by the mart's alias, never the query name.
      expect(screen.getByRole('checkbox', { name: 'Event Date' })).toBeChecked();
      expect(screen.queryByRole('checkbox', { name: 'Date' })).not.toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Cost' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Traffic Source' })).not.toBeChecked();
    });

    it('a ticked field applies after the delay, and a burst of ticks applies once', async () => {
      await openMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Fields' }));
      const query = vi.mocked(api.queryDataMart);
      await waitFor(() => expect(query).toHaveBeenCalledTimes(1), past);
      const before = query.mock.calls.length;

      fireEvent.click(await screen.findByRole('checkbox', { name: 'Traffic Source' }));
      // The checkbox flips at once; the document is untouched until the delay elapses.
      expect(screen.getByRole('checkbox', { name: 'Traffic Source' })).toBeChecked();
      expect(query.mock.calls.length).toBe(before);

      // A second tick inside the window restarts the timer, so both land in one wave.
      fireEvent.click(screen.getByRole('checkbox', { name: 'Unique Count' }));

      await waitFor(
        () => expect(query.mock.calls.length).toBeGreaterThan(before),
        { timeout: FIELDS_APPLY_DELAY_MS + APPLY_DEBOUNCE_MS + 1500 },
      );
      expect(screen.getByRole('checkbox', { name: 'Traffic Source' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Unique Count' })).toBeChecked();
    }, 15000);
  });

  it('shows the failure text on a component whose query errored, not a bare Refresh button', async () => {
    vi.spyOn(db, 'getDashboard').mockResolvedValue(dashWithScorecard());
    vi.spyOn(api, 'queryDataMart').mockRejectedValue(new Error('Unknown column: Unique Count'));

    renderAt('d1');
    await screen.findByText('Sales');

    const alert = await screen.findByRole('alert', {}, past);
    expect(alert).toHaveTextContent('Unknown column: Unique Count');
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
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

  // ---- Cross-filtering (Task 16) ----
  //
  // CRITICAL: a cross-filter must be a SERVER-side filter pushed into compile()'s filterConfig —
  // never a client-side re-filter of already-fetched rows. These tests assert on the SECOND
  // queryDataMart call's filterConfig, i.e. a genuine new request went out, not a re-render of
  // stale data.

  it('clicking a bar segment recompiles the query server-side (filterConfig gets the eq filter) and refetches every component', async () => {
    vi.spyOn(db, 'getDashboard').mockResolvedValue(dashWithBar());
    const query = vi.spyOn(api, 'queryDataMart').mockResolvedValue(barResult);

    renderAt('d1');
    await screen.findByText('Sales');
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2), past); // one per component (bar + scorecard)

    const chip = await screen.findByRole('button', { name: 'google' });
    fireEvent.click(chip);

    // Both components refetch: 2 more calls (bar + scorecard), all carrying the new filter.
    await waitFor(() => expect(query).toHaveBeenCalledTimes(4), past);
    const laterCalls = query.mock.calls.slice(2);
    for (const [, request] of laterCalls) {
      expect(request.filterConfig).toEqual(
        expect.arrayContaining([{ column: 'Source', operator: 'eq', value: 'google', placement: 'post-join' }]),
      );
    }
  });

  it('clicking a SECOND segment widens the cross-filter to `in`, server-side, instead of replacing it', async () => {
    vi.spyOn(db, 'getDashboard').mockResolvedValue(dashWithBar());
    const query = vi.spyOn(api, 'queryDataMart').mockResolvedValue(barResult);

    renderAt('d1');
    await screen.findByText('Sales');
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2), past);

    fireEvent.click(await screen.findByRole('button', { name: 'google' }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(4), past);

    fireEvent.click(await screen.findByRole('button', { name: 'meta' }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(6), past);

    // Both values now travel in ONE rule — an eq per value would AND to zero rows.
    for (const [, request] of query.mock.calls.slice(4)) {
      expect(request.filterConfig).toEqual(
        expect.arrayContaining([
          { column: 'Source', operator: 'in', value: ['google', 'meta'], placement: 'post-join' },
        ]),
      );
    }
    // Both chips read as pressed, so the selection is visible without relying on colour.
    expect(screen.getByRole('button', { name: 'google' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'meta' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('deselecting one of two selected segments narrows back to a single `eq`', async () => {
    vi.spyOn(db, 'getDashboard').mockResolvedValue(dashWithBar());
    const query = vi.spyOn(api, 'queryDataMart').mockResolvedValue(barResult);

    renderAt('d1');
    await screen.findByText('Sales');
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2), past);

    fireEvent.click(await screen.findByRole('button', { name: 'google' }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(4), past);
    fireEvent.click(await screen.findByRole('button', { name: 'meta' }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(6), past);

    fireEvent.click(screen.getByRole('button', { name: 'google' }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(8), past);

    for (const [, request] of query.mock.calls.slice(6)) {
      expect(request.filterConfig).toEqual(
        expect.arrayContaining([
          { column: 'Source', operator: 'eq', value: 'meta', placement: 'post-join' },
        ]),
      );
    }
    expect(screen.getByRole('button', { name: 'google' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking the SAME already-active segment again toggles the cross-filter OFF and refetches back to the unfiltered query', async () => {
    vi.spyOn(db, 'getDashboard').mockResolvedValue(dashWithBar());
    const query = vi.spyOn(api, 'queryDataMart').mockResolvedValue(barResult);

    renderAt('d1');
    await screen.findByText('Sales');
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2), past);

    const chip = await screen.findByRole('button', { name: 'google' });
    fireEvent.click(chip); // apply
    await waitFor(() => expect(query).toHaveBeenCalledTimes(4), past);

    fireEvent.click(chip); // toggle off
    await waitFor(() => expect(query).toHaveBeenCalledTimes(6), past);

    const finalCalls = query.mock.calls.slice(4);
    for (const [, request] of finalCalls) {
      const filters = (request.filterConfig ?? []) as { column: string }[];
      expect(filters.some(f => f.column === 'Source')).toBe(false);
    }
  });

  it('a cross-filter and a pre-existing global filter BOTH reach the compiled query', async () => {
    const dash: Dashboard = { ...dashWithBar(), filters: [{ column: 'Cost', operator: 'gt', value: 100 }] };
    vi.spyOn(db, 'getDashboard').mockResolvedValue(dash);
    const query = vi.spyOn(api, 'queryDataMart').mockResolvedValue(barResult);

    renderAt('d1');
    await screen.findByText('Sales');
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2), past);

    const chip = await screen.findByRole('button', { name: 'meta' });
    fireEvent.click(chip);

    await waitFor(() => expect(query).toHaveBeenCalledTimes(4), past);
    const [, request] = query.mock.calls[2];
    expect(request.filterConfig).toEqual(expect.arrayContaining([
      { column: 'Cost', operator: 'gt', value: 100, placement: 'post-join' },
      { column: 'Source', operator: 'eq', value: 'meta', placement: 'post-join' },
    ]));
  });

  it('"Reset filters" clears an active cross-filter and refetches back to the unfiltered query', async () => {
    vi.spyOn(db, 'getDashboard').mockResolvedValue(dashWithBar());
    const query = vi.spyOn(api, 'queryDataMart').mockResolvedValue(barResult);

    renderAt('d1');
    await screen.findByText('Sales');
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2), past);

    fireEvent.click(await screen.findByRole('button', { name: 'google' }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(4), past);

    fireEvent.click(screen.getByRole('button', { name: /reset filters/i }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(6), past);

    const finalCalls = query.mock.calls.slice(4);
    for (const [, request] of finalCalls) {
      const filters = (request.filterConfig ?? []) as { column: string }[];
      expect(filters.some(f => f.column === 'Source')).toBe(false);
    }
  });

  it('surfaces the server truncated flag rather than dropping it', async () => {
    // A scorecard's value comes from `totals`, not `rows`, so `truncated` (which describes
    // `rows`) has nothing to surface there — this exercises the renderer that actually shows it.
    const dash: Dashboard = {
      ...dashWithScorecard(),
      components: [
        { id: 'a', type: 'table', title: 'Revenue', width: 1, height: 1, config: { columns: ['Cost'], limit: 10 } },
      ],
    };
    vi.spyOn(db, 'getDashboard').mockResolvedValue(dash);
    vi.spyOn(api, 'queryDataMart').mockResolvedValue({ ...emptyResult, columns: ['Cost'], rows: [[1]], truncated: true });

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

  // ---- Task 20/M7: a cross-filter click is EPHEMERAL view-state — never persisted, never survives
  // a reload — while still flowing into the real server query. ----

  it('Save does not persist an active cross-filter — it stays view-state only (M7)', async () => {
    const dash = dashWithBar();
    vi.spyOn(db, 'getDashboard').mockResolvedValue(dash);
    const query = vi.spyOn(api, 'queryDataMart').mockResolvedValue(barResult);
    const save = vi.spyOn(db, 'saveDashboard').mockImplementation(async d => ({ ...d, configVersion: d.configVersion + 1 }));

    renderAt('d1');
    await screen.findByText('Sales');
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2), past);

    fireEvent.click(await screen.findByRole('button', { name: 'google' }));
    await screen.findByText(/Filtered by.*google/i, {}, past); // cross-filter visibly active

    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const [savedDoc] = save.mock.calls[0];
    expect(savedDoc.filters).toEqual([]); // the cross-filter never reached the saved doc
  });

  it('a cross-filter does not survive a reload of the same dashboard (M7)', async () => {
    vi.spyOn(db, 'getDashboard').mockResolvedValue(dashWithBar());
    const query = vi.spyOn(api, 'queryDataMart').mockResolvedValue(barResult);

    const { unmount } = renderAt('d1');
    await screen.findByText('Sales');
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2), past);

    fireEvent.click(await screen.findByRole('button', { name: 'google' }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(4), past);
    unmount();

    query.mockClear();
    renderAt('d1'); // fresh mount, same id — simulates a reload
    await screen.findByText('Sales');
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2), past); // unfiltered — no cross-filter carried over

    for (const [, request] of query.mock.calls) {
      const filters = (request.filterConfig ?? []) as { column: string }[];
      expect(filters.some(f => f.column === 'Source')).toBe(false);
    }
  });
});
