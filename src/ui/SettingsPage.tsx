import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { PRESET_GROUPS, PRESET_LABELS, type Preset, type Settings } from '../types';

export function SettingsPage({ settings, onSave, onBack, onRebuild, canRebuild = true, error }: {
  settings: Settings; onSave: (s: Settings) => void; onBack: () => void;
  /** Reads the descriptions and schemas again and replaces the model for everyone. */
  onRebuild?: () => void; canRebuild?: boolean; error?: string | null;
}) {
  const [threshold, setThreshold] = useState(String(settings.thresholdPct));
  const [preset, setPreset] = useState<Preset>(settings.defaultPreset);
  const [comparison, setComparison] = useState(settings.comparisonDefault);

  const save = () => {
    const n = Number(threshold);
    const thresholdPct = Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : settings.thresholdPct;
    onSave({ thresholdPct, defaultPreset: preset, comparisonDefault: comparison });
  };

  return (
    <div className="dm-page">
      <header className="dm-page-header gy-settings-header">
        <button type="button" className="gy-icon-btn" aria-label="Back" title="Back" onClick={onBack}><ArrowLeft size={16} /></button>
        <h1 className="dm-page-header-title">Settings</h1>
      </header>
      <main className="dm-page-content">
        <form className="dm-card gy-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <p className="dm-muted gy-form-note">These settings apply to everyone in the project.</p>
          <div className="gy-field">
            <label htmlFor="gy-threshold">Red when below plan by more than (%)</label>
            <input id="gy-threshold" className="gy-input" type="number" min={1} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            <span className="dm-muted gy-field-hint">A card between plan and this threshold shows orange.</span>
          </div>
          <div className="gy-field">
            <label htmlFor="gy-default-range">Default date range</label>
            <select id="gy-default-range" className="gy-select" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              {PRESET_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.presets.map((p) => <option key={p} value={p}>{PRESET_LABELS[p]}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <label className="gy-check">
            <input type="checkbox" checked={comparison} onChange={(e) => setComparison(e.target.checked)} />
            Compare with previous period by default
          </label>
          {error && <p role="alert" className="gy-form-error">{error}</p>}
          <div className="gy-form-actions">
            <button type="submit" className="gy-btn gy-btn-primary">Save</button>
            <button type="button" className="gy-btn" onClick={onBack}>Cancel</button>
          </div>
        </form>
        {onRebuild && (
          <section className="dm-card gy-form" aria-labelledby="gy-model-title">
            <h2 id="gy-model-title" className="gy-form-title">Model</h2>
            <p className="dm-muted gy-form-note">
              Reads the project description and the Data Mart schemas again and redraws the canvas for everyone.
              Use it after changing the metrics table, links or calculated fields.
            </p>
            <div className="gy-form-actions">
              <button type="button" className="gy-btn" onClick={onRebuild} disabled={!canRebuild}>Rebuild model</button>
            </div>
            {!canRebuild && <p className="dm-muted gy-form-note">Ask a project admin to map an AI model</p>}
          </section>
        )}
      </main>
    </div>
  );
}
