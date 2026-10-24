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
  preset: Preset;
  comparisonOn: boolean;
  cache: CacheDoc | null;
  now: Date;
  onPreset: (p: Preset) => void;
  onComparison: (on: boolean) => void;
  onRefresh: () => void;
  onRebuild: () => void;
  onSettings: () => void;
}

export function Header({ title, preset, comparisonOn, cache, now, onPreset, onComparison, onRefresh, onRebuild, onSettings }: Props) {
  return (
    <header className="gy-header">
      <div>
        <div className="label">GYROSCOPE</div>
        <div style={{ fontSize: 24 }}>{title}</div>
      </div>
      <div className="gy-header-tools">
        <select aria-label="Date range" value={preset} onChange={(e) => onPreset(e.target.value as Preset)}>
          {PRESET_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.presets.map((p) => <option key={p} value={p}>{PRESET_LABELS[p]}</option>)}
            </optgroup>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={comparisonOn} onChange={(e) => onComparison(e.target.checked)} />{' '}
          Compare with previous period
        </label>
        <button type="button" className="gy-btn" onClick={onRefresh}>Refresh</button>
        <button type="button" className="gy-btn" onClick={onRebuild}>Rebuild model</button>
        <button type="button" className="gy-btn" onClick={onSettings}>Settings</button>
        <span className="gy-muted">{cache ? `Updated ${relativeTime(cache.refreshedAt, now)}` : 'Not loaded yet'}</span>
      </div>
    </header>
  );
}
