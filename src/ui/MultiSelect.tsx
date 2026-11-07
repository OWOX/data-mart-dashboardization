import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useBelow } from './anchor';

export interface MultiOption<T> { value: T; label: string; group?: string }

/**
 * OWOX's MultiSelect: a field showing the picks as badges, over a list where each option toggles. Built like `Select`
 * (a combobox on the field, the list below it). Arrow keys, Home and End move the highlight, Enter or Space toggles it,
 * Escape closes. The list stays open while picking. With `max` set, once that many are picked the others are disabled and
 * the list says so. Options carrying a `group` are listed under that heading, in the order given.
 * Picks are reported in the order they were made; the badges show them in the options' order.
 */
export function MultiSelect<T extends string | number>({ label, value, options, onChange, placeholder = 'Select…', max, maxShown = 3, describedBy }: {
  label: string; value: T[]; options: MultiOption<T>[]; onChange: (next: T[]) => void; placeholder?: string;
  max?: number; maxShown?: number; describedBy?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState<T | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const style = useBelow(anchor, open);
  const byKeys = useRef(false);
  const full = max !== undefined && value.length >= max;
  const picked = (o: MultiOption<T>) => value.includes(o.value);
  const enabled = (i: number) => !!options[i] && (picked(options[i]!) || !full);
  const optId = (i: number) => `${id}-o${i}`;
  const at = options.findIndex((o) => o.value === activeValue);
  const active = at >= 0 && enabled(at) ? at : -1;
  const shown = options.filter(picked);
  useEffect(() => { if (open && active >= 0 && byKeys.current) document.getElementById(`${id}-o${active}`)?.scrollIntoView?.({ block: 'nearest' }); }, [open, active, id]);

  const toggle = (v: T) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const show = () => {
    byKeys.current = true;
    setOpen(true);
    const first = options.findIndex((o, i) => picked(o) && enabled(i));
    const any = options.findIndex((_, i) => enabled(i));
    setActiveValue(options[first >= 0 ? first : any]?.value ?? null);
  };
  const seek = (from: number, d: number) => { for (let i = from + d; i >= 0 && i < options.length; i += d) if (enabled(i)) return i; return from; };
  const step = (i: number) => { if (!enabled(i)) return; byKeys.current = true; setActiveValue(options[i]!.value); };
  const pick = (i: number) => { if (enabled(i)) toggle(options[i]!.value); };

  const groups: { name: string | undefined; from: number }[] = [];
  options.forEach((o, i) => { if (i === 0 || o.group !== options[i - 1]!.group) groups.push({ name: o.group, from: i }); });

  const badges = shown.length <= maxShown ? shown : shown.slice(0, 1);
  const remove = (v: T) => (e: { stopPropagation: () => void }) => { e.stopPropagation(); toggle(v); };

  return (
    <>
      <div
        ref={anchor} tabIndex={0} role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined} aria-describedby={describedBy}
        className="gy-input gy-pick gy-multi" onClick={() => (open ? setOpen(false) : show())} onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) show();
            else if (active < 0) step(e.key === 'ArrowDown' ? seek(-1, 1) : seek(options.length, -1));
            else step(seek(active, e.key === 'ArrowDown' ? 1 : -1));
          } else if (e.key === 'Home' || e.key === 'End') {
            if (!open) return;
            e.preventDefault();
            step(e.key === 'Home' ? seek(-1, 1) : seek(options.length, -1));
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!open) show();
            else if (active >= 0) pick(active);
          } else if (e.key === 'Escape') {
            if (open) { e.preventDefault(); setOpen(false); }
          }
        }}
      >
        <span className="gy-multi-vals">
          {shown.length === 0 && <span className="gy-multi-ph">{placeholder}</span>}
          {badges.map((o) => (
            <span key={String(o.value)} className="gy-tag">
              {o.label}
              <span className="gy-tag-x" aria-hidden="true" onClick={remove(o.value)} onMouseDown={(e) => e.preventDefault()}><X size={10} /></span>
            </span>
          ))}
          {shown.length > maxShown && <span className="gy-tag gy-tag-more">+{shown.length - 1}</span>}
        </span>
        <ChevronsUpDown size={12} aria-hidden="true" className="gy-pick-chev" />
      </div>
      {open && (
        // mousedown would blur the combobox before the click lands
        <div id={`${id}-list`} role="listbox" aria-label={label} aria-multiselectable="true" className="gy-combo-list gy-combo-flat gy-multi-list" style={style} onMouseDown={(e) => e.preventDefault()}>
          {groups.map((g, gi) => {
            const end = gi + 1 < groups.length ? groups[gi + 1]!.from : options.length;
            return (
              <div key={g.name ?? gi} role="group" aria-label={g.name}>
                {g.name && <div className="gy-combo-head" aria-hidden="true">{g.name}</div>}
                {options.slice(g.from, end).map((o, k) => {
                  const i = g.from + k;
                  const on = picked(o);
                  return (
                    <div
                      key={String(o.value)} id={optId(i)} role="option" aria-selected={on} aria-disabled={!enabled(i) || undefined}
                      className={`gy-combo-opt gy-multi-opt${!enabled(i) ? ' gy-combo-off' : ''}${active === i ? ' gy-combo-active' : ''}`}
                      onMouseEnter={() => { if (enabled(i)) { byKeys.current = false; setActiveValue(o.value); } }} onClick={() => pick(i)}
                    >
                      <Check size={12} aria-hidden="true" className="gy-multi-check" data-on={on} />
                      {o.label}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {max !== undefined && <div className="gy-combo-note" aria-live="polite">{value.length} of {max} picked{full ? ', the most allowed' : ''}</div>}
        </div>
      )}
    </>
  );
}
