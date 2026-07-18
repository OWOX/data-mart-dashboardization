import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listDashboards, deleteDashboard, duplicateDashboard } from '../lib/dashboards';
import type { Dashboard } from '../lib/types';
import { CreateDashboardDialog } from './CreateDashboardDialog';
import { RowMenu } from './ui/RowMenu';
import { BTN } from './ui/controls';
import { PlusIcon, PencilIcon, CopyIcon, TrashIcon } from './ui/icons';

/**
 * Presentational truncation only (YYYY-MM-DD out of an ISO timestamp) — no client-side
 * calculation, matching the ui/lib/format.ts rule.
 */
const fmtDate = (iso?: string) => (iso ? iso.slice(0, 10) : '—');

/**
 * The landing page. A frameless table on a grey page (modeled on the host's Credentials/Plugins
 * lists, without the boxed card): Name, Created ($createdAt), Modified ($updatedAt), plus a per-row
 * kebab (Edit / Duplicate / Delete). There is deliberately NO Author column — the host strips
 * $createdBy before a doc ever reaches the plugin, so a plugin has no user id to show.
 */
export function DashboardList() {
  const [items, setItems] = useState<Dashboard[] | null>(null);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const reload = () => { void listDashboards().then(setItems); };
  useEffect(reload, []);

  const open = (id: string) => navigate(`/d/${id}`);

  return (
    <div className="dm-page bg-muted text-foreground">
      <header className="dm-page-header">
        <h1 className="dm-page-header-title">Dashboards</h1>
      </header>
      <div className="dm-page-content pb-6">
        <div className="mb-4 flex justify-end">
          <button type="button" className={BTN} onClick={() => setCreating(true)}>
            <PlusIcon />
            New dashboard
          </button>
        </div>

        {items === null && <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>}
        {items?.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No dashboards yet. Create one to visualize a Data Mart.
          </p>
        )}

        {items && items.length > 0 && (
          <div className="w-full overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="h-10 px-4 align-middle font-medium">Name</th>
                  <th className="h-10 px-4 align-middle font-medium whitespace-nowrap">Created</th>
                  <th className="h-10 px-4 align-middle font-medium whitespace-nowrap">Modified</th>
                  <th className="h-10 w-px px-4" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {items.map(d => (
                  <tr
                    key={d.id}
                    className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-background"
                    onClick={e => { if (!(e.target as HTMLElement).closest('button, a')) open(d.id); }}
                  >
                    <td className="px-4 py-3 align-middle">
                      <Link to={`/d/${d.id}`} className="font-medium hover:underline">{d.name}</Link>
                    </td>
                    <td className="px-4 py-3 align-middle whitespace-nowrap text-muted-foreground">{fmtDate(d.$createdAt)}</td>
                    <td className="px-4 py-3 align-middle whitespace-nowrap text-muted-foreground">{fmtDate(d.$updatedAt)}</td>
                    <td className="w-px px-4 py-3 text-right align-middle whitespace-nowrap">
                      <RowMenu
                        items={[
                          { label: 'Edit', icon: <PencilIcon />, onSelect: () => open(d.id) },
                          { label: 'Duplicate', icon: <CopyIcon />, onSelect: () => void duplicateDashboard(d).then(reload) },
                          { label: 'Delete', icon: <TrashIcon />, danger: true, divider: true,
                            onSelect: () => void deleteDashboard(d.id).then(reload) },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <CreateDashboardDialog onClose={() => { setCreating(false); reload(); }} />}
    </div>
  );
}
