import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ICON_BTN, MENU, MENU_ITEM, MENU_ITEM_DANGER, MENU_DIVIDER } from './controls';
import { MoreHorizontalIcon } from './icons';

export type RowMenuItem = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  /** Draw a divider above this item (e.g. before a destructive action). */
  divider?: boolean;
};

// Table-row actions kebab (⋯), modeled on the host's RowMenu: portaled to <body> with fixed
// positioning so the table's overflow can't clip it, closes on outside-click / Escape, and
// re-places on scroll/resize. Reusable — pass the items each row needs.
export function RowMenu({ items, label = 'Actions' }: { items: RowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
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

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={ICON_BTN}
        onClick={() => { if (!open) place(); setOpen(o => !o); }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
      >
        <MoreHorizontalIcon />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" style={{ position: 'fixed', top: pos.top, right: pos.right }} className={MENU}>
          {items.map((it, i) => (
            <div key={i}>
              {it.divider && <div className={MENU_DIVIDER} />}
              <button
                type="button"
                role="menuitem"
                className={it.danger ? MENU_ITEM_DANGER : MENU_ITEM}
                onClick={() => { setOpen(false); it.onSelect(); }}
              >
                {it.icon}
                {it.label}
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
