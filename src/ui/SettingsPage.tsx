import { useState } from 'react';
import { PRESET_GROUPS, PRESET_LABELS, type Preset, type Settings } from '../types';

export function SettingsPage({ settings, onSave, onBack, error }: { settings: Settings; onSave: (s: Settings) => void; onBack: () => void; error?: string | null }) {
  const [threshold, setThreshold] = useState(String(settings.thresholdPct));
  const [preset, setPreset] = useState<Preset>(settings.defaultPreset);
  const [comparison, setComparison] = useState(settings.comparisonDefault);

  const save = () => {
    const n = Number(threshold);
    const thresholdPct = Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : settings.thresholdPct;
    onSave({ thresholdPct, defaultPreset: preset, comparisonDefault: comparison });
  };

  return (
    <main className="gy-main">
      <h1>Settings</h1>
      <p><label>Red when below plan by more than (%){' '}
        <input type="number" min={1} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
      </label></p>
      <p><label>Default date range{' '}
        <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
          {PRESET_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.presets.map((p) => <option key={p} value={p}>{PRESET_LABELS[p]}</option>)}
            </optgroup>
          ))}
        </select>
      </label></p>
      <p><label>
        <input type="checkbox" checked={comparison} onChange={(e) => setComparison(e.target.checked)} />{' '}
        Compare with previous period by default
      </label></p>
      <fieldset disabled><legend>Properties — coming later</legend></fieldset>
      {error && <p role="alert">{error}</p>}
      <p>
        <button type="button" className="gy-btn gy-btn-primary" onClick={save}>Save</button>{' '}
        <button type="button" className="gy-btn" onClick={onBack}>Back</button>
      </p>
    </main>
  );
}
