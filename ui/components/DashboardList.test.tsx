import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';
import { DashboardList } from './DashboardList';
import * as db from '../lib/dashboards';
import * as api from '../lib/api';
import * as gen from '../lib/generate';
import { emptyDashboard } from '../lib/types';
import type { MartField, MartRef } from '../lib/types';

// The real DashboardView lands in Task 12. This stub only proves the create flow's
// `navigate('/d/:id')` lands on the target route with the right id — it does not depend on
// anything Task 12 will build.
function LandedProbe() {
  const { id } = useParams();
  return <p>Landed on dashboard {id}</p>;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<DashboardList />} />
        <Route path="/d/:id" element={<LandedProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const mart: MartRef = { id: 'm1', title: 'Mart One' };
const fields: MartField[] = [
  { name: 'Date', type: 'DATE', role: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
  { name: 'Source', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT', 'COUNT_DISTINCT'] },
  { name: 'Cost', type: 'FLOAT', role: 'metric', allowedAggregations: ['SUM', 'AVG'] },
];

describe('DashboardList', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders each dashboard the host made visible', async () => {
    vi.spyOn(db, 'listDashboards').mockResolvedValue([
      { ...emptyDashboard('d1', 'm1', 'Sales'), $updatedAt: '2026-07-01T00:00:00Z' },
    ]);
    renderApp();
    expect(await screen.findByText('Sales')).toBeInTheDocument();
  });

  it('shows an empty state when there are none', async () => {
    vi.spyOn(db, 'listDashboards').mockResolvedValue([]);
    renderApp();
    expect(await screen.findByText(/no dashboards/i)).toBeInTheDocument();
  });

  it('shows Created and Modified columns, and never an Author column', async () => {
    vi.spyOn(db, 'listDashboards').mockResolvedValue([
      {
        ...emptyDashboard('d1', 'm1', 'Sales'),
        $createdAt: '2026-06-01T00:00:00Z',
        $updatedAt: '2026-07-01T00:00:00Z',
      },
    ]);
    renderApp();
    await screen.findByText('Sales');
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Modified')).toBeInTheDocument();
    expect(screen.queryByText('Author')).not.toBeInTheDocument();
  });

  it('duplicates a dashboard via the row action and refreshes the list', async () => {
    const dash = emptyDashboard('d1', 'm1', 'Sales');
    vi.spyOn(db, 'listDashboards').mockResolvedValue([dash]);
    const dup = vi.spyOn(db, 'duplicateDashboard').mockResolvedValue({ ...dash, id: 'd2', name: 'Sales (copy)' });

    renderApp();
    await screen.findByText('Sales');
    fireEvent.click(screen.getByRole('button', { name: /duplicate/i }));

    await waitFor(() => expect(dup).toHaveBeenCalledWith(dash));
    await waitFor(() => expect(db.listDashboards).toHaveBeenCalledTimes(2));
  });

  it('deletes a dashboard via the row action and refreshes the list', async () => {
    const dash = emptyDashboard('d1', 'm1', 'Sales');
    vi.spyOn(db, 'listDashboards').mockResolvedValue([dash]);
    const del = vi.spyOn(db, 'deleteDashboard').mockResolvedValue(undefined);

    renderApp();
    await screen.findByText('Sales');
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(del).toHaveBeenCalledWith('d1'));
    await waitFor(() => expect(db.listDashboards).toHaveBeenCalledTimes(2));
  });

  it('opening a dashboard links straight to /d/:id', async () => {
    vi.spyOn(db, 'listDashboards').mockResolvedValue([emptyDashboard('d1', 'm1', 'Sales')]);
    renderApp();
    const link = await screen.findByRole('link', { name: 'Sales' });
    expect(link).toHaveAttribute('href', '/d/d1');
  });

  describe('create flow', () => {
    beforeEach(() => {
      vi.spyOn(db, 'listDashboards').mockResolvedValue([]);
    });

    it('opens the create dialog and lists available marts', async () => {
      vi.spyOn(api, 'listMarts').mockResolvedValue([mart]);
      renderApp();
      await screen.findByText(/no dashboards/i);

      fireEvent.click(screen.getByRole('button', { name: /new dashboard/i }));

      expect(await screen.findByText('Mart One')).toBeInTheDocument();
    });

    it('explains rather than dead-ending when there are no marts to build from', async () => {
      vi.spyOn(api, 'listMarts').mockResolvedValue([]);
      renderApp();
      await screen.findByText(/no dashboards/i);

      fireEvent.click(screen.getByRole('button', { name: /new dashboard/i }));

      expect(await screen.findByText(/no data marts/i)).toBeInTheDocument();
    });

    it('explains rather than dead-ending when the mart list fails to load', async () => {
      vi.spyOn(api, 'listMarts').mockRejectedValue(new Error('network down'));
      renderApp();
      await screen.findByText(/no dashboards/i);

      fireEvent.click(screen.getByRole('button', { name: /new dashboard/i }));

      expect(await screen.findByText(/couldn.t load/i)).toBeInTheDocument();
    });

    it('shows a busy indicator while probing the mart, since probes are real queries', async () => {
      vi.spyOn(api, 'listMarts').mockResolvedValue([mart]);
      let resolveFields!: (v: MartField[]) => void;
      vi.spyOn(api, 'getMartFields').mockReturnValue(new Promise(res => { resolveFields = res; }));
      vi.spyOn(gen, 'probeCardinality').mockResolvedValue({});
      vi.spyOn(gen, 'generate').mockReturnValue(emptyDashboard('new-id', 'm1', 'Mart One'));
      vi.spyOn(db, 'saveDashboard').mockResolvedValue(emptyDashboard('new-id', 'm1', 'Mart One'));

      renderApp();
      await screen.findByText(/no dashboards/i);
      fireEvent.click(screen.getByRole('button', { name: /new dashboard/i }));
      fireEvent.click(await screen.findByText('Mart One'));

      expect(await screen.findByText(/analysing/i)).toBeInTheDocument();
      resolveFields([]);
      await waitFor(() => expect(screen.queryByText(/analysing/i)).not.toBeInTheDocument());
    });

    it('picks a mart, generates, saves, and lands on the new dashboard', async () => {
      vi.spyOn(api, 'listMarts').mockResolvedValue([mart]);
      vi.spyOn(api, 'getMartFields').mockResolvedValue(fields);
      const probe = vi.spyOn(gen, 'probeCardinality').mockResolvedValue({ Source: 3 });
      const generated = emptyDashboard('new-id', 'm1', 'Mart One');
      const generateSpy = vi.spyOn(gen, 'generate').mockReturnValue(generated);
      vi.spyOn(db, 'saveDashboard').mockResolvedValue({ ...generated });

      renderApp();
      await screen.findByText(/no dashboards/i);
      fireEvent.click(screen.getByRole('button', { name: /new dashboard/i }));
      fireEvent.click(await screen.findByText('Mart One'));

      expect(await screen.findByText(/landed on dashboard new-id/i)).toBeInTheDocument();
      // Only the non-date dimension is probed for cardinality; the date field is excluded.
      expect(probe).toHaveBeenCalledWith('m1', [fields[1]]);
      expect(generateSpy).toHaveBeenCalledWith('m1', 'Mart One', fields, { Source: 3 });
      expect(db.saveDashboard).toHaveBeenCalledWith(generated);
    });

    it('shows an error and keeps the dialog open when creation itself fails', async () => {
      vi.spyOn(api, 'listMarts').mockResolvedValue([mart]);
      vi.spyOn(api, 'getMartFields').mockRejectedValue(new Error('boom'));

      renderApp();
      await screen.findByText(/no dashboards/i);
      fireEvent.click(screen.getByRole('button', { name: /new dashboard/i }));
      fireEvent.click(await screen.findByText('Mart One'));

      expect(await screen.findByText(/couldn.t create/i)).toBeInTheDocument();
      // The dialog stays open so the user can retry instead of silently landing nowhere.
      expect(screen.getByText('Mart One')).toBeInTheDocument();
    });

    describe('accessibility', () => {
      const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

      it('is a labeled, modal dialog', async () => {
        vi.spyOn(api, 'listMarts').mockResolvedValue([mart]);
        renderApp();
        await screen.findByText(/no dashboards/i);
        fireEvent.click(screen.getByRole('button', { name: /new dashboard/i }));

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        const labelledBy = dialog.getAttribute('aria-labelledby');
        expect(labelledBy).toBeTruthy();
        expect(document.getElementById(labelledBy!)).toHaveTextContent(/choose a data mart/i);
      });

      it('moves focus into the dialog on open', async () => {
        vi.spyOn(api, 'listMarts').mockResolvedValue([mart]);
        renderApp();
        await screen.findByText(/no dashboards/i);
        fireEvent.click(screen.getByRole('button', { name: /new dashboard/i }));

        const dialog = await screen.findByRole('dialog');
        expect(dialog.contains(document.activeElement)).toBe(true);
      });

      it('Escape closes the dialog', async () => {
        vi.spyOn(api, 'listMarts').mockResolvedValue([mart]);
        renderApp();
        await screen.findByText(/no dashboards/i);
        fireEvent.click(screen.getByRole('button', { name: /new dashboard/i }));
        await screen.findByRole('dialog');

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      it('traps Tab focus within the dialog: Shift+Tab from the first control wraps to the last', async () => {
        vi.spyOn(api, 'listMarts').mockResolvedValue([mart]);
        renderApp();
        await screen.findByText(/no dashboards/i);
        fireEvent.click(screen.getByRole('button', { name: /new dashboard/i }));

        const dialog = await screen.findByRole('dialog');
        await screen.findByText('Mart One');
        const focusables = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
        expect(focusables.length).toBeGreaterThan(1);
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        first.focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(last);

        last.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.activeElement).toBe(first);
      });

      it('restores focus to the "New dashboard" trigger once the dialog closes', async () => {
        vi.spyOn(api, 'listMarts').mockResolvedValue([mart]);
        renderApp();
        await screen.findByText(/no dashboards/i);

        const trigger = screen.getByRole('button', { name: /new dashboard/i });
        trigger.focus();
        fireEvent.click(trigger);
        await screen.findByRole('dialog');
        expect(document.activeElement).not.toBe(trigger); // focus moved into the panel

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(document.activeElement).toBe(trigger);
      });
    });
  });
});
