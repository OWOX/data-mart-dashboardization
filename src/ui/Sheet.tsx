import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal panel on the right edge, drawn like OWOX's Sheet: title and description over a rule, the body, then the footer.
 * It makes the rest of the page inert while open, so focus stays inside; Tab also wraps at the ends. Escape closes it unless a
 * control inside already used the key (an open list), a click on the dim area closes it, and when it goes away focus
 * returns to `returnTo`, or to whatever had focus when it opened.
 */
export function Sheet({ title, description, onClose, returnTo, children }: {
  title: string; description: string; onClose: () => void; returnTo?: HTMLElement | null; children: ReactNode;
}) {
  const titleId = useId();
  const descId = useId();
  const overlay = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // the slide-in animation holds a transform, which would make fixed popups inside measure against the panel; drop it when done
  const [settled, setSettled] = useState(false);
  // the opener is read once, on the first render, before the sheet takes focus
  const opener = useRef<HTMLElement | null>(returnTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null));

  useEffect(() => {
    const dimmed = [...document.body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el !== overlay.current && !el.inert);
    for (const el of dimmed) el.inert = true;
    const first = panel.current?.querySelector<HTMLElement>('.gy-sheet-body input, .gy-sheet-body [tabindex="0"], .gy-sheet-body button') ?? panel.current;
    first?.focus();
    const back = opener.current;
    return () => {
      for (const el of dimmed) el.inert = false;
      if (back?.isConnected) back.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose(); return; }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[inert]') && el.getClientRects().length > 0);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === panel.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  };

  return createPortal(
    <div ref={overlay} className="gy-sheet-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} tabIndex={-1} className="gy-sheet" data-settled={settled || undefined} onKeyDown={onKeyDown} onAnimationEnd={(e) => { if (e.target === e.currentTarget) setSettled(true); }}>
        <div className="gy-sheet-header">
          <h2 id={titleId} className="gy-sheet-title">{title}</h2>
          <p id={descId} className="gy-sheet-desc">{description}</p>
          <button type="button" className="gy-sheet-close" aria-label="Close" onClick={onClose}><X size={16} aria-hidden="true" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
