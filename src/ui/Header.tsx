import { RefreshCw, Settings as SettingsIcon, TriangleAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatPeriod } from '../lib/format';
import type { CacheDoc, CompareChoice, DateWindow, RangeChoice, WeekStart } from '../types';
import { DateRangePicker } from './DateRangePicker';
import { IssuesLayer, noticeCount, type Notices } from './IssuesLayer';

function relativeTime(iso: string, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

interface Props {
  cache: CacheDoc | null;
  now: Date;
  /** The selected range and, when comparison is on, the window it is compared with. */
  period?: { range: DateWindow; comparison: DateWindow | null };
  /** The loading step; replaces the update time while it is set. */
  status?: string | null;
  /** Broken references and the out-of-date notice; the icon shows while there is any. */
  notices?: Notices;
}

export function Header({ cache, now, period, status = null, notices }: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const count = notices ? noticeCount(notices) : 0;
  const updated = status ?? (cache ? `Updated ${relativeTime(cache.refreshedAt, now)}` : 'Not loaded yet');
  const windows = period ? formatPeriod(period.range, period.comparison) : null;
  return (
    <header className="gy-header">
      <div className="gy-header-line">
        <h1 className="gy-header-title">Gyroscope</h1>
        {notices && count > 0 && (
          <span className="gy-issues-anchor">
            <button ref={trigger} type="button" className="gy-icon-btn gy-issues-btn" aria-label={`${count} ${count === 1 ? 'issue' : 'issues'}`} title="Issues"
              aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <TriangleAlert size={16} aria-hidden />
            </button>
            {open && <IssuesLayer notices={notices} layerRef={layer} triggerRef={trigger} onClose={close} />}
          </span>
        )}
        <span className="gy-header-sub num" aria-live="polite">{windows ? `${windows} · ${updated}` : updated}</span>
      </div>
    </header>
  );
}

/**
 * The date range control, then Refresh and Settings as icons. They sit on the canvas toolbar,
 * level with the context chips.
 */
export function RangeControls({ range, compare, now, weekStart = 'monday', refreshing = false, onChange, onRefresh, onSettings }: {
  range: RangeChoice; compare: CompareChoice; now: Date; weekStart?: WeekStart; refreshing?: boolean;
  onChange: (range: RangeChoice, compare: CompareChoice) => void; onRefresh: () => void; onSettings: () => void;
}) {
  return (
    <div className="gy-range">
      <DateRangePicker range={range} compare={compare} now={now} weekStart={weekStart} onChange={onChange} />
      <button type="button" className="gy-icon-btn" aria-label="Refresh" title="Refresh" onClick={onRefresh} disabled={refreshing}>
        <RefreshCw size={16} className={refreshing ? 'gy-spin' : undefined} />
      </button>
      <button type="button" className="gy-icon-btn" aria-label="Settings" title="Settings" onClick={onSettings}>
        <SettingsIcon size={16} />
      </button>
    </div>
  );
}
