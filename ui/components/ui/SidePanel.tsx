import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ICON_BTN } from './controls';
import { CloseIcon } from './icons';

/**
 * The dashboard's one right-hand drawer: Fields, a component's configuration, slicers — anything
 * that needs room to work in while the dashboard stays visible behind it.
 *
 * Dismissal is deliberately forgiving: a click anywhere outside, or Escape, closes it. The
 * outside-click listener attaches on the next tick, because the very click that opened the panel
 * is still propagating when this mounts and would otherwise close it immediately.
 */
export function SidePanel({
  title, description, width = '22rem', onClose, children, footer,
}: {
  title: string;
  description?: string;
  /** Wider for the Fields picker's three columns; the default suits a single form. */
  width?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    const timer = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={headingId}
      className="dm-card fixed right-3 top-3 bottom-3 z-50 flex flex-col overflow-hidden shadow-lg"
      style={{ width, maxWidth: 'calc(100vw - 1.5rem)' }}
    >
      <header className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 id={headingId} className="text-sm font-medium">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        <button type="button" className={ICON_BTN} aria-label="Close panel" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className="flex-1 overflow-auto p-4">{children}</div>
      {footer && <footer className="border-t px-4 py-3">{footer}</footer>}
    </div>,
    document.body,
  );
}
