import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useBelow } from './anchor';
import { useReadOnly } from './readOnly';

export interface SelectOption { value: string; label: string; disabled?: boolean }

/**
 * A select-only combobox drawn like the forecast picker's list, in place of a native select. The current value is on
 * `data-value`. Arrow keys, Home and End move the highlight, Enter or Space picks, Escape closes, a letter jumps to
 * the next option starting with it; with the list closed, a letter, Home and End change the value as a native select
 * does.
 */
export function Select({ label, value, options, className = '', invalid, describedBy, title, onChange }: {
  label: string; value: string; options: SelectOption[]; className?: string;
  invalid?: boolean; describedBy?: string; title?: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const locked = useReadOnly();
  const [open, setOpen] = useState(false);
  // the highlighted option by value, so it stays put while the options change under an open list
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const style = useBelow(anchor, open);
  // only for the keyboard: scrolling under a hovering pointer would move the next option beneath it
  const byKeys = useRef(false);
  const optId = (i: number) => `${id}-o${i}`;
  const current = options.find((o) => o.value === value);
  const enabled = (i: number) => !!options[i] && !options[i]!.disabled;
  // -1: nothing highlighted (none yet, a disabled current value, or an option that went away); Enter then only closes
  const at = options.findIndex((o) => o.value === activeValue);
  const active = at >= 0 && enabled(at) ? at : -1;
  const selected = options.findIndex((o) => o.value === value);
  useEffect(() => { if (open && active >= 0 && byKeys.current) document.getElementById(`${id}-o${active}`)?.scrollIntoView?.({ block: 'nearest' }); }, [open, active, id]);

  const show = () => { byKeys.current = true; setOpen(true); setActiveValue(enabled(selected) ? value : null); };
  const close = () => setOpen(false);
  const pick = (i: number) => { const o = options[i]; if (o && !o.disabled) { if (o.value !== value) onChange(o.value); close(); } };
  // the next enabled option from `from` in direction `d`, or `from` when there is none
  const seek = (from: number, d: number) => { for (let i = from + d; i >= 0 && i < options.length; i += d) if (enabled(i)) return i; return from; };
  const step = (i: number) => { if (!enabled(i)) return; byKeys.current = true; setActiveValue(options[i]!.value); };
  // the next enabled option after `from` whose label starts with `k`, wrapping; -1 when there is none
  const typed = (from: number, k: string) => {
    const n = options.length;
    for (let j = 1; j <= n; j++) { const i = (((from + j) % n) + n) % n; if (enabled(i) && options[i]!.label.toLowerCase().startsWith(k)) return i; }
    return -1;
  };
  // with the list closed the keys change the value itself, as a native select's do
  const move = (i: number) => { if (open) step(i); else if (i >= 0 && i !== selected) onChange(options[i]!.value); };

  return (
    <>
      <div
        ref={anchor} tabIndex={locked ? undefined : 0} aria-disabled={locked || undefined} role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined} aria-invalid={invalid || undefined} aria-describedby={describedBy}
        title={title} data-value={value} className={`gy-input gy-pick ${className}`.trim()}
        onClick={locked ? undefined : () => (open ? close() : show())} onBlur={close}
        onKeyDown={locked ? undefined : (e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) show();
            // with nothing highlighted, Down starts at the first option and Up at the last
            else if (active < 0) step(e.key === 'ArrowDown' ? seek(-1, 1) : seek(options.length, -1));
            else step(seek(active, e.key === 'ArrowDown' ? 1 : -1));
          } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            const i = e.key === 'Home' ? seek(-1, 1) : seek(options.length, -1);
            move(enabled(i) ? i : -1);
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!open) show();
            else if (active >= 0) pick(active);
            else close();
          } else if (e.key === 'Escape') {
            if (open) { e.preventDefault(); close(); }
          } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
            move(typed(open ? active : selected, e.key.toLowerCase()));
          }
        }}
      >
        <span className="gy-pick-text">{current?.label ?? value}</span>
        <ChevronDown size={14} aria-hidden="true" className="gy-pick-chev" />
      </div>
      {open && (
        // mousedown would blur the combobox before the click lands
        <div id={`${id}-list`} role="listbox" aria-label={label} className="gy-combo-list gy-combo-flat" style={style} onMouseDown={(e) => e.preventDefault()}>
          {options.map((o, i) => (
            <div
              key={o.value} id={optId(i)} role="option" data-value={o.value} aria-selected={o.value === value} aria-disabled={o.disabled || undefined}
              className={`gy-combo-opt${o.disabled ? ' gy-combo-off' : ''}${active === i ? ' gy-combo-active' : ''}`}
              onMouseEnter={() => { if (!o.disabled) { byKeys.current = false; setActiveValue(o.value); } }} onClick={() => pick(i)}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
