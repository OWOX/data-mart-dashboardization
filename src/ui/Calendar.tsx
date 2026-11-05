import { useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, eachDay, parseDay, weekdayIndex } from '../lib/dates';
import type { DateWindow, Day, WeekStart } from '../types';

const WEEKDAYS: Record<WeekStart, string[]> = {
  monday: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
  sunday: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
};
const MONTHS = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, i, 1))));
const LONG = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export const monthStart = (d: Day): Day => `${d.slice(0, 7)}-01`;
export const shiftMonth = (d: Day, n: number): Day => {
  const t = new Date(parseDay(monthStart(d)));
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + n, 1)).toISOString().slice(0, 10);
};

/**
 * The month or year name as a button that opens a vertical list under the title. The list holds focus: arrows move, Enter
 * picks, Escape closes only itself, and leaving it (a click elsewhere) closes it.
 */
function TitleList({ label, text, items, value, now, onPick }: {
  label: string; text: string; items: { value: number; label: string }[]; value: number; now?: number; onPick: (v: number) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { list.current?.focus(); document.getElementById(`${id}-o${active}`)?.scrollIntoView?.({ block: 'nearest' }); } }, [open, active, id]);
  const show = () => { setActive(Math.max(items.findIndex((i) => i.value === value), 0)); setOpen(true); };
  const pick = (i: number) => { const it = items[i]; setOpen(false); if (it && it.value !== value) onPick(it.value); };
  return (
    <>
      <button type="button" className="gy-cal-title" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => (open ? setOpen(false) : show())}>{text}</button>
      {open && (
        <div ref={list} id={`${id}-list`} role="listbox" tabIndex={-1} aria-label={label} aria-activedescendant={`${id}-o${active}`} className="gy-combo-list gy-combo-flat gy-cal-list"
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.min(Math.max(a + (e.key === 'ArrowDown' ? 1 : -1), 0), items.length - 1)); }
            else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setActive(e.key === 'Home' ? 0 : items.length - 1); }
            else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active); }
            // the picker panel closes on Escape too; this one only closes the list
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
          }}>
          {items.map((it, i) => (
            <div key={it.value} id={`${id}-o${i}`} role="option" aria-selected={it.value === value} aria-current={it.value === now ? 'date' : undefined}
              className={`gy-combo-opt${active === i ? ' gy-combo-active' : ''}${it.value === now ? ' gy-cal-now' : ''}`}
              onMouseEnter={() => setActive(i)} onClick={() => pick(i)}>
              {it.label}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Whole weeks, starting on `ws`, covering the month. */
function gridDays(month: Day, ws: WeekStart): Day[] {
  const first = monthStart(month);
  const dow = weekdayIndex(first, ws);
  const last = addDays(shiftMonth(first, 1), -1);
  const lastDow = weekdayIndex(last, ws);
  return eachDay({ from: addDays(first, -dow), to: addDays(last, 6 - lastDow) });
}

export function Calendar({ month, selected, isDisabled, weekStart = 'monday', anchorYear, onPick, onMonth, 'aria-label': label }: {
  month: Day; selected: DateWindow | null; isDisabled?: (d: Day) => boolean; weekStart?: WeekStart; /** The year the year list is built around: 10 years back, one ahead. */ anchorYear?: number;
  onPick: (d: Day) => void; onMonth: (month: Day) => void; 'aria-label': string;
}) {
  const ym = month.slice(0, 7);
  const year = Number(month.slice(0, 4));
  const ay = anchorYear ?? year;
  const years = Array.from({ length: 12 }, (_, i) => ({ value: ay - 10 + i, label: String(ay - 10 + i) }));
  const goto = (y: number, m: number) => onMonth(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`);
  return (
    <div className="gy-cal" role="group" aria-label={label}>
      <div className="gy-cal-head">
        <button type="button" className="gy-cal-nav" aria-label="Previous month" onClick={() => onMonth(shiftMonth(month, -1))}><ChevronLeft size={16} aria-hidden /></button>
        <span className="gy-cal-titles" aria-live="polite">
          <TitleList label="Month" text={MONTHS[Number(ym.slice(5)) - 1]!} items={MONTHS.map((l, i) => ({ value: i + 1, label: l }))} value={Number(ym.slice(5))} onPick={(m) => goto(year, m)} />
          <TitleList label="Year" text={String(year)} items={years} value={year} now={ay} onPick={(y) => goto(y, Number(ym.slice(5)))} />
        </span>
        <button type="button" className="gy-cal-nav" aria-label="Next month" onClick={() => onMonth(shiftMonth(month, 1))}><ChevronRight size={16} aria-hidden /></button>
      </div>
      <div className="gy-cal-grid">
        {WEEKDAYS[weekStart].map((w) => <span key={w} className="gy-cal-dow" aria-hidden>{w}</span>)}
        {gridDays(month, weekStart).map((d) => {
          const inRange = !!selected && d >= selected.from && d <= selected.to;
          const end = !!selected && (d === selected.from || d === selected.to);
          const cls = ['gy-cal-day', d.slice(0, 7) !== ym && 'is-out', inRange && !end && 'is-mid', end && 'is-end'].filter(Boolean).join(' ');
          return (
            <button key={d} type="button" className={cls} disabled={isDisabled?.(d)} aria-pressed={inRange}
              aria-label={LONG.format(new Date(parseDay(d)))} onClick={() => onPick(d)}>
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
