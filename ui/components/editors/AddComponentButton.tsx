import { useState } from 'react';
import type { ComponentType } from '../../lib/types';

const TYPES: { type: ComponentType; label: string }[] = [
  { type: 'scorecard', label: 'Scorecard' },
  { type: 'timeseries', label: 'Time series' },
  { type: 'bar', label: 'Bar chart' },
  { type: 'pie', label: 'Pie chart' },
  { type: 'donut', label: 'Donut chart' },
  { type: 'table', label: 'Table' },
];

/**
 * Opens a small menu of component types; picking one calls `onAdd(type)`, which the caller wires
 * to `addComponent` (Task 15's `edit.ts`). No new UI dependency — a plain toggled panel, same
 * pattern as the rest of this plugin's dialogs/menus (see `CreateDashboardDialog`).
 */
export function AddComponentButton({ onAdd }: { onAdd: (type: ComponentType) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        className="rounded border px-3 py-1.5 text-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        + Add component
      </button>
      {open && (
        <>
          {/* Click-outside-to-close backdrop, transparent so it never obscures the page. */}
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div role="menu" className="dm-card absolute right-0 z-20 mt-1 w-44 space-y-0.5 p-1 shadow-lg">
            {TYPES.map(t => (
              <button
                key={t.type}
                role="menuitem"
                type="button"
                className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-black/5"
                onClick={() => {
                  onAdd(t.type);
                  setOpen(false);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
