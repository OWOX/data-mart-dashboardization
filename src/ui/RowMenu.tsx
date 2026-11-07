import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useBelow } from './anchor';

export interface RowMenuItem { label: string; icon: LucideIcon; onSelect: () => void; danger?: boolean }

/**
 * OWOX's row actions menu: a ghost "more" button that opens a short list. Enter, Space or Down opens it on the first
 * item; Up and Down, Home and End move, Escape closes and puts focus back on the button, Tab closes. Picking an item
 * closes the list and hands focus back to the button before the action runs, so an action that opens something (the
 * sheet) can take focus from there.
 */
export function RowMenu({ label, items, rowId, buttons }: { label: string; items: RowMenuItem[]; rowId?: string; buttons?: Map<string, HTMLButtonElement> }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const style = useBelow(button, open, true);
  // the button is registered under the row's id so the row can hand focus back to it; the callback keeps its identity between renders
  const setButton = useCallback((el: HTMLButtonElement | null) => {
    button.current = el;
    if (!buttons || rowId === undefined) return;
    if (el) buttons.set(rowId, el); else buttons.delete(rowId);
  }, [buttons, rowId]);
  const itemEls = () => [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  // opening puts focus on the first item, once the list is in the page
  useEffect(() => { if (open) itemEls()[0]?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!list.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const onItemKey = (e: KeyboardEvent) => {
    const els = itemEls();
    const at = els.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => { e.preventDefault(); els[(i + els.length) % els.length]?.focus(); };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(els.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); button.current?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <>
      <button
        ref={setButton} type="button" className="gy-row-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <div ref={list} id={`${id}-menu`} role="menu" aria-label={label} className="gy-menu" style={style} onKeyDown={onItemKey}>
          {items.map((item, i) => (
            <div key={item.label} role="none">
              {item.danger && i > 0 && <div className="gy-menu-sep" role="separator" />}
              <button
                type="button" role="menuitem" tabIndex={-1} className="gy-menu-item" data-danger={item.danger || undefined}
                onClick={() => { setOpen(false); button.current?.focus(); item.onSelect(); }}
              >
                <item.icon size={16} aria-hidden="true" />{item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
