import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MENU, MENU_DIVIDER, MENU_ITEM } from './ui/controls';
import { CodeIcon, EyeOffIcon, MoreVerticalIcon, RefreshIcon, SettingsIcon } from './ui/icons';

/**
 * Per-component ⋮ menu. Same portaled placement as the dashboard's own menu, so the two read as
 * one family; the actions are the ones that only make sense for a single tile.
 */
export function ComponentMenu({
  title, onConfigure, onRefresh, onCopySql, onHide,
}: {
  title: string;
  onConfigure: () => void;
  onRefresh: () => void;
  onCopySql: () => void;
  onHide: () => void;
}) {
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

  const run = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="rounded px-1 text-sm text-muted-foreground hover:bg-black/5"
        aria-label={`Actions for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { place(); setOpen(o => !o); }}
      >
        <MoreVerticalIcon />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" className={`fixed ${MENU}`} style={{ top: pos.top, right: pos.right }}>
          <button role="menuitem" className={MENU_ITEM} onClick={run(onConfigure)}>
            <SettingsIcon />Configure
          </button>
          <button role="menuitem" className={MENU_ITEM} onClick={run(onRefresh)}>
            <RefreshIcon />Refresh
          </button>
          <button role="menuitem" className={MENU_ITEM} onClick={run(onCopySql)}>
            <CodeIcon />Copy SQL
          </button>
          <div className={MENU_DIVIDER} />
          <button role="menuitem" className={MENU_ITEM} onClick={run(onHide)}>
            <EyeOffIcon />Hide
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
