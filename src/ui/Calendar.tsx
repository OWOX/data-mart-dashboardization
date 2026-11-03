import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, eachDay, parseDay, weekdayIndex } from '../lib/dates';
import type { DateWindow, Day, WeekStart } from '../types';

const WEEKDAYS: Record<WeekStart, string[]> = {
  monday: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
  sunday: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
};
const TITLE = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const LONG = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export const monthStart = (d: Day): Day => `${d.slice(0, 7)}-01`;
export const shiftMonth = (d: Day, n: number): Day => {
  const t = new Date(parseDay(monthStart(d)));
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + n, 1)).toISOString().slice(0, 10);
};

/** Whole weeks, starting on `ws`, covering the month. */
function gridDays(month: Day, ws: WeekStart): Day[] {
  const first = monthStart(month);
  const dow = weekdayIndex(first, ws);
  const last = addDays(shiftMonth(first, 1), -1);
  const lastDow = weekdayIndex(last, ws);
  return eachDay({ from: addDays(first, -dow), to: addDays(last, 6 - lastDow) });
}

export function Calendar({ month, selected, isDisabled, weekStart = 'monday', onPick, onMonth, 'aria-label': label }: {
  month: Day; selected: DateWindow | null; isDisabled?: (d: Day) => boolean; weekStart?: WeekStart;
  onPick: (d: Day) => void; onMonth: (month: Day) => void; 'aria-label': string;
}) {
  const ym = month.slice(0, 7);
  return (
    <div className="gy-cal" role="group" aria-label={label}>
      <div className="gy-cal-head">
        <button type="button" className="gy-cal-nav" aria-label="Previous month" onClick={() => onMonth(shiftMonth(month, -1))}><ChevronLeft size={16} aria-hidden /></button>
        <span className="gy-cal-title" aria-live="polite">{TITLE.format(new Date(parseDay(monthStart(month))))}</span>
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
