import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BTN, ICON_BTN, MENU, MENU_DIVIDER, MENU_ITEM, MENU_ITEM_DANGER } from './ui/controls';
import {
  CopyIcon, ExternalLinkIcon, FilterIcon, LayoutIcon, MoreVerticalIcon, RefreshIcon, SlidersIcon,
  TrashIcon,
} from './ui/icons';
import type { Dashboard } from '../lib/types';

type Props = {
  dashboard: Dashboard;
  onOpenFields: () => void;
  onOpenSlicers: () => void;
  onRefresh: () => void;
  onDuplicate: () => void;
  onRestoreLayout: () => void;
  onEditLayout: () => void;
  onDelete: () => void;
  onOpenDataMart: () => void;
  busy?: boolean;
};

/**
 * The dashboard's ⋯ menu. Mirrors the row kebab in DashboardList (portaled, outside-click and
 * Escape to close) but sits in the page header and carries dashboard-wide actions, one of which —
 * Fields — opens a panel rather than firing immediately.
 */
export function DashboardMenu({
  dashboard, onOpenFields, onOpenSlicers, onRefresh, onDuplicate, onRestoreLayout, onEditLayout,
  onDelete, onOpenDataMart, busy,
}: Props) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<'delete' | null>(null);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const run = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={ICON_BTN}
        aria-label="Dashboard actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => { place(); setOpen(o => !o); }}
      >
        <MoreVerticalIcon />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className={`fixed ${MENU}`}
          style={{ top: pos.top, right: pos.right }}
        >
          <button role="menuitem" className={MENU_ITEM} onClick={run(onOpenFields)}>
            <SlidersIcon />Fields
          </button>
          <button role="menuitem" className={MENU_ITEM} onClick={run(onOpenSlicers)}>
            <FilterIcon />Slicers
          </button>
          <button role="menuitem" className={MENU_ITEM} onClick={run(onRefresh)}>
            <RefreshIcon />Refresh
          </button>
          <button role="menuitem" className={MENU_ITEM} onClick={run(onDuplicate)}>
            <CopyIcon />Duplicate
          </button>
          <button
            role="menuitem"
            className={MENU_ITEM}
            aria-haspopup="menu"
            aria-expanded={layoutOpen}
            onClick={() => setLayoutOpen(o => !o)}
          >
            <LayoutIcon />Layout
            <span className="ml-auto text-muted-foreground">{layoutOpen ? '▾' : '▸'}</span>
          </button>
          {layoutOpen && (
            <div role="group" aria-label="Layout" className="pl-4">
              <button role="menuitem" className={MENU_ITEM} onClick={run(onEditLayout)}>Edit</button>
              <button role="menuitem" className={MENU_ITEM} onClick={run(onRestoreLayout)}>Restore</button>
            </div>
          )}
          <button role="menuitem" className={MENU_ITEM} onClick={run(onOpenDataMart)}>
            <ExternalLinkIcon />Open Data Mart
          </button>
          <div className={MENU_DIVIDER} />
          <button role="menuitem" className={MENU_ITEM_DANGER} onClick={run(() => setPanel('delete'))}>
            <TrashIcon />Delete
          </button>
        </div>,
        document.body,
      )}

      {panel === 'delete' && (
        <DeleteDialog
          name={dashboard.name}
          onConfirm={() => { setPanel(null); onDelete(); }}
          onClose={() => setPanel(null)}
        />
      )}
    </>
  );
}

function DeleteDialog({
  name, onConfirm, onClose,
}: { name: string; onConfirm: () => void; onClose: () => void }) {
  const headingId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/40" role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <div className="dm-card w-[26rem] p-4">
        <h2 id={headingId} className="mb-2 text-base font-medium">Delete &ldquo;{name}&rdquo;?</h2>
        <p className="mb-4 text-sm">
          This cannot be undone. The dashboard and its layout are deleted permanently; the Data Mart
          itself is not affected.
        </p>
        <div className="flex justify-end gap-2">
          <button className={BTN} onClick={onClose}>Cancel</button>
          <button
            ref={confirmRef}
            className={`${BTN} border-red-600 text-red-600 hover:bg-red-50`}
            onClick={onConfirm}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every(v => b.has(v));
