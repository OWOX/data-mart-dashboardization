import type { ReactNode } from 'react';
import type { Component, Dashboard } from '../lib/types';

/**
 * The N-column grid (default 5). A component spans `width` columns and `height` rows, so the only
 * legal widths are 1..gridColumns — 20/40/60/80/100% at the default. Arbitrary widths are impossible
 * by construction. On narrow screens the grid collapses to a single column, preserving order.
 */
export function Grid({
  dashboard,
  children,
}: {
  dashboard: Dashboard;
  children: (component: Component) => ReactNode;
}) {
  const cols = Math.max(1, dashboard.gridColumns);
  return (
    <div
      className="dmd-grid grid gap-4"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: '7rem' }}
    >
      {dashboard.components.map(c => (
        <div
          key={c.id}
          style={{
            gridColumn: `span ${Math.min(Math.max(1, c.width), cols)}`,
            gridRow: `span ${Math.max(1, c.height)}`,
          }}
        >
          {children(c)}
        </div>
      ))}
    </div>
  );
}
