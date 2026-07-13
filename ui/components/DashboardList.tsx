import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listDashboards, deleteDashboard, duplicateDashboard } from '../lib/dashboards';
import type { Dashboard } from '../lib/types';
import { CreateDashboardDialog } from './CreateDashboardDialog';

/**
 * Presentational truncation only (YYYY-MM-DD out of an ISO timestamp) — no client-side
 * calculation, matching the ui/lib/format.ts rule.
 */
const fmtDate = (iso?: string) => (iso ? iso.slice(0, 10) : '—');

/**
 * The landing page. Columns: Name, Created ($createdAt), Modified ($updatedAt). There is
 * deliberately NO Author column — the host strips $createdBy before a doc ever reaches the
 * plugin (see lib/dashboards.ts / lib/types.ts), so a plugin has no user id to show.
 */
export function DashboardList() {
  const [items, setItems] = useState<Dashboard[] | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = () => { void listDashboards().then(setItems); };
  useEffect(reload, []);

  return (
    <div className="dm-page text-foreground">
      <header className="dm-page-header">
        <h1 className="dm-page-header-title">Dashboards</h1>
      </header>
      <div className="dm-page-content">
        <div className="dm-card">
          <div className="flex justify-end p-4">
            <button className="rounded border px-3 py-1.5 text-sm" onClick={() => setCreating(true)}>
              New dashboard
            </button>
          </div>

          {items === null && <p className="p-6 text-sm">Loading…</p>}
          {items?.length === 0 && <p className="p-6 text-sm">No dashboards yet.</p>}

          {items && items.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="p-3">Name</th>
                  <th className="p-3">Created</th>
                  <th className="p-3">Modified</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {items.map(d => (
                  <tr key={d.id} className="border-t">
                    <td className="p-3"><Link to={`/d/${d.id}`}>{d.name}</Link></td>
                    <td className="p-3">{fmtDate(d.$createdAt)}</td>
                    <td className="p-3">{fmtDate(d.$updatedAt)}</td>
                    <td className="p-3 text-right">
                      <button className="mr-2" onClick={() => void duplicateDashboard(d).then(reload)}>Duplicate</button>
                      <button onClick={() => void deleteDashboard(d.id).then(reload)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {creating && <CreateDashboardDialog onClose={() => { setCreating(false); reload(); }} />}
    </div>
  );
}
