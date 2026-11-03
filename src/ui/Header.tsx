import { RefreshCw, Settings as SettingsIcon } from 'lucide-react';
import { PRESET_GROUPS, PRESET_LABELS, type CacheDoc, type Preset } from '../types';

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
  title: string;
  cache: CacheDoc | null;
  now: Date;
  refreshing?: boolean;
  onRefresh: () => void;
  onRebuild: () => void;
  onSettings: () => void;
}

export function Header({ title, cache, now, refreshing = false, onRefresh, onRebuild, onSettings }: Props) {
  return (
    <header className="gy-header">
      <div>
        <div className="label">GYROSCOPE</div>
        <h1 className="gy-header-title">{title}</h1>
      </div>
      <div className="gy-header-tools">
        <span className="gy-muted">{cache ? `Updated ${relativeTime(cache.refreshedAt, now)}` : 'Not loaded yet'}</span>
        <button type="button" className="gy-btn" onClick={onRebuild}>Rebuild model</button>
        <button type="button" className="gy-icon-btn" aria-label="Refresh" title="Refresh" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw size={16} className={refreshing ? 'gy-spin' : undefined} />
        </button>
        <button type="button" className="gy-icon-btn" aria-label="Settings" title="Settings" onClick={onSettings}>
          <SettingsIcon size={16} />
        </button>
      </div>
    </header>
  );
}

/** The date range and the comparison toggle; they sit on the canvas toolbar, level with the context chips. */
export function RangeControls({ preset, comparisonOn, onPreset, onComparison }: {
  preset: Preset; comparisonOn: boolean; onPreset: (p: Preset) => void; onComparison: (on: boolean) => void;
}) {
  return (
    <div className="gy-range">
      <label className="gy-check">
        <input type="checkbox" checked={comparisonOn} onChange={(e) => onComparison(e.target.checked)} />
        Compare with previous period
      </label>
      <select className="gy-select" aria-label="Date range" value={preset} onChange={(e) => onPreset(e.target.value as Preset)}>
        {PRESET_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.presets.map((p) => <option key={p} value={p}>{PRESET_LABELS[p]}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
