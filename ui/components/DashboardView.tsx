import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getDashboard } from '../lib/dashboards';
import type { Dashboard } from '../lib/types';

/**
 * Placeholder landing page for a single dashboard.
 *
 * Task 11 only needs the create flow to land somewhere real at `/d/:id` inside the mandatory
 * chrome; the grid, global filter bar, and component renderers are Task 12's job (Grid +
 * DashboardView + FilterBar) and will replace this file's body. This stub proves the id
 * round-trips through the route and that a missing/undeletable-race doc doesn't crash the page.
 */
export function DashboardView() {
  const { id } = useParams<{ id: string }>();
  const [dashboard, setDashboard] = useState<Dashboard | null | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    setDashboard(undefined);
    void getDashboard(id).then(setDashboard);
  }, [id]);

  return (
    <div className="dm-page text-foreground">
      <header className="dm-page-header">
        <h1 className="dm-page-header-title">{dashboard?.name ?? 'Dashboard'}</h1>
      </header>
      <div className="dm-page-content">
        <div className="dm-card p-6 text-sm">
          {dashboard === undefined && <p>Loading…</p>}
          {dashboard === null && <p>Dashboard not found.</p>}
          {dashboard && <p>{dashboard.components.length} component(s). Full view coming in a later task.</p>}
        </div>
      </div>
    </div>
  );
}
