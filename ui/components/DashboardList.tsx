import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listDashboards, deleteDashboard, duplicateDashboard } from '../lib/dashboards';
import type { Dashboard } from '../lib/types';
import { CreateDashboardDialog } from './CreateDashboardDialog';
import { RowMenu } from './ui/RowMenu';
import { BTN, INPUT } from './ui/controls';
import { PlusIcon, PencilIcon, CopyIcon, TrashIcon, SearchIcon } from './ui/icons';

/**
 * Presentational truncation only (YYYY-MM-DD out of an ISO timestamp) — no client-side
 * calculation, matching the ui/lib/format.ts rule.
 */
const fmtDate = (iso?: string) => (iso ? iso.slice(0, 10) : '—');

/**
 * The landing page: a framed table matching the host's Destinations/Storages lists — a `dm-card`
 * frame around a toolbar (search + New), the table, and a count footer. Columns: Name, Created
 * ($createdAt), Modified ($updatedAt), plus a per-row kebab (Edit / Duplicate / Delete). There is
 * deliberately NO Author column — the host strips $createdBy before a doc reaches the plugin.
 * The search box filters the already-loaded list by name (presentation, not a data query).
 */
export function DashboardList() {
  const [items, setItems] = useState<Dashboard[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const reload = () => { void listDashboards().then(setItems); };
  useEffect(reload, []);

  const open = (id: string) => navigate(`/d/${id}`);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter(d => !q || d.name.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <div className="dm-page text-foreground">
      <header className="dm-page-header">
        <h1 className="dm-page-header-title">Dashboards</h1>
      </header>
      <div className="dm-page-content pb-6">
        <div className="dm-card">
          {/* Toolbar: search (left) + New (right), mirroring the host tables. */}
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                className={`${INPUT} pl-9`}
                placeholder="Search"
                aria-label="Search dashboards"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
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
          {items !== null && items.length > 0 && shown.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">No dashboards match “{query}”.</p>
          )}

          {shown.length > 0 && (
            <div className="w-full overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="h-11 px-4 align-middle font-medium">Name</th>
                    <th className="h-11 px-4 align-middle font-medium whitespace-nowrap">Created</th>
                    <th className="h-11 px-4 align-middle font-medium whitespace-nowrap">Modified</th>
                    <th className="h-11 w-px px-4" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map(d => (
                    <tr
                      key={d.id}
                      className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent"
                      onClick={e => { if (!(e.target as HTMLElement).closest('button, a')) open(d.id); }}
                    >
                      <td className="px-4 py-3.5 align-middle">
                        <Link to={`/d/${d.id}`} className="font-medium hover:underline">{d.name}</Link>
                      </td>
                      <td className="px-4 py-3.5 align-middle whitespace-nowrap text-muted-foreground">{fmtDate(d.$createdAt)}</td>
                      <td className="px-4 py-3.5 align-middle whitespace-nowrap text-muted-foreground">{fmtDate(d.$updatedAt)}</td>
                      <td className="w-px px-4 py-3.5 text-right align-middle whitespace-nowrap">
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

          {shown.length > 0 && (
            <div className="mt-4 flex justify-end text-xs text-muted-foreground">
              {shown.length} of {items?.length ?? shown.length} dashboard{(items?.length ?? 0) === 1 ? '' : 's'}
            </div>
          )}
        </div>
      </div>
      {creating && <CreateDashboardDialog onClose={() => { setCreating(false); reload(); }} />}
    </div>
  );
}
