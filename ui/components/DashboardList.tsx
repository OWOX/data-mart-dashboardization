import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listDashboards, deleteDashboard } from '../lib/dashboards';
import type { Dashboard } from '../lib/types';
import { CreateDashboardDialog } from './CreateDashboardDialog';
import { RowMenu } from './ui/RowMenu';
import { BTN } from './ui/controls';
import { PlusIcon, PencilIcon, TrashIcon } from './ui/icons';

/**
 * Presentational truncation only (YYYY-MM-DD out of an ISO timestamp) — no client-side
 * calculation, matching the ui/lib/format.ts rule.
 */
const fmtDate = (iso?: string) => (iso ? iso.slice(0, 10) : '—');

/**
 * The landing page. Columns: Name, Created ($createdAt), Modified ($updatedAt), plus a per-row
 * kebab (Edit / Delete) matching the host's Plugins list. There is deliberately NO Author column —
 * the host strips $createdBy before a doc ever reaches the plugin (see lib/dashboards.ts /
 * lib/types.ts), so a plugin has no user id to show.
 */
export function DashboardList() {
  const [items, setItems] = useState<Dashboard[] | null>(null);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const reload = () => { void listDashboards().then(setItems); };
  useEffect(reload, []);

  return (
    <div className="dm-page text-foreground">
      <header className="dm-page-header">
        <h1 className="dm-page-header-title">Dashboards</h1>
      </header>
      <div className="dm-page-content">
        <div className="dm-card !p-0">
          <div className="flex justify-end border-b border-border p-4">
            <button type="button" className={BTN} onClick={() => setCreating(true)}>
              <PlusIcon />
              New dashboard
            </button>
          </div>

          {items === null && <p className="p-6 text-sm text-muted-foreground">Loading…</p>}
          {items?.length === 0 && <p className="p-6 text-sm text-muted-foreground">No dashboards yet.</p>}

          {items && items.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5 font-medium">Modified</th>
                  <th className="w-12 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {items.map(d => (
                  <tr key={d.id} className="border-b border-border last:border-0 hover:bg-accent">
                    <td className="px-4 py-2.5">
                      <Link to={`/d/${d.id}`} className="font-medium hover:underline">{d.name}</Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(d.$createdAt)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(d.$updatedAt)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <RowMenu
                        items={[
                          { label: 'Edit', icon: <PencilIcon />, onSelect: () => navigate(`/d/${d.id}`) },
                          { label: 'Delete', icon: <TrashIcon />, danger: true, divider: true,
                            onSelect: () => void deleteDashboard(d.id).then(reload) },
                        ]}
                      />
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
