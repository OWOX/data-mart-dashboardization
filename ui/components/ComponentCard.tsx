import type { ReactNode } from 'react';
import type { LayerStatus } from '../lib/freshness';

/**
 * The card chrome every dashboard component renders inside, plus the preload affordance: while a
 * refetch is in flight (`status === 'loading'`), the last-good `children` stays visible at reduced
 * opacity behind a progress line instead of flashing empty (see `useLayerData`). On a stale result
 * with an error, a "Refresh" overlay lets the user retry without losing the last-good render.
 */
export function ComponentCard({
  title, status, error, onRefresh, children, actions,
}: {
  title: string; status: LayerStatus; error: string | null;
  onRefresh: () => void; children: ReactNode;
  /** Optional header-right slot (Task 15's ⋯ edit menu trigger) — omitted, the header is unchanged. */
  actions?: ReactNode;
}) {
  const busy = status === 'loading';
  return (
    <div className="dm-card relative flex h-full flex-col overflow-hidden">
      {busy && <div className="dmd-progress" aria-label="Updating" />}
      <div className="flex items-start justify-between gap-2 px-4 pt-3">
        <div className="text-sm font-medium">{title}</div>
        {actions}
      </div>
      <div className={`flex-1 p-4 ${busy ? 'pointer-events-none opacity-50' : ''}`}>{children}</div>
      {status === 'stale' && error && (
        // The message, not just the button: a bare "Refresh" over an empty chart says a query failed
        // but never which one or why, which is indistinguishable on screen from a mart that simply
        // has no matching rows. The host's own text is the only thing that tells those apart.
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/5 p-4">
          <p role="alert" className="max-w-full overflow-hidden text-center text-xs text-red-600">{error}</p>
          <button className="rounded border bg-white px-3 py-1 text-sm" onClick={onRefresh}>Refresh</button>
        </div>
      )}
    </div>
  );
}
