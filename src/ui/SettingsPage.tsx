import { useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import { PRESET_GROUPS, PRESET_LABELS, type BuildResult, type Model, type Preset, type Settings, type WeekStart } from '../types';
import type { MartDetail, OwoxLike } from '../owox/sources';
import type { BuildStep } from '../model/build';
import { LoadingLine } from './LoadingLine';
import { OntologyTab } from './OntologyTab';
import { CheckupTab, type CheckupProps } from './CheckupTab';

export type SettingsTab = 'general' | 'ontology' | 'checkup';
const TABS: { id: SettingsTab; label: string }[] = [{ id: 'general', label: 'General' }, { id: 'ontology', label: 'Metrics' }, { id: 'checkup', label: 'Checkup' }];

/** What the Metrics tab edits; null while the Data Marts are still being read. */
export interface OntologyProps {
  model: Model;
  details: ReadonlyMap<string, MartDetail>;
  marts: { id: string; title: string }[] | null;
  owox: OwoxLike;
  now: () => Date;
  onSave: (m: Model) => Promise<void>;
  hashOf?: (m: Model) => Promise<string | null>;
}

export function SettingsPage({ settings, onSave, onBack, onRebuild, canRebuild = true, projectId, onOpen, onDismiss, error, tab: initialTab = 'general', onTabChange, ontology, checkup }: {
  settings: Settings; onSave: (s: Settings) => void; onBack: () => void;
  /** Reads the descriptions and schemas again into a candidate model; the Ontology tab shows it as a proposal. */
  onRebuild?: (onStep: (s: BuildStep) => void) => Promise<BuildResult>; canRebuild?: boolean; projectId?: string; onOpen?: (path: string) => void;
  /** A proposal was discarded: the canvas stops calling the model out of date against the hash it checked. */
  onDismiss?: () => void; error?: string | null;
  tab?: SettingsTab; onTabChange?: (t: SettingsTab) => void; ontology?: OntologyProps | null;
  /** What the Checkup tab runs; the tab is mounted only while selected, so each visit starts a run. */
  checkup?: CheckupProps | null;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const go = (t: SettingsTab) => { setTab(t); onTabChange?.(t); };
  const onTabKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    go(TABS[to]!.id);
    tabRefs.current[TABS[to]!.id]?.focus();
  };
  const [threshold, setThreshold] = useState(String(settings.thresholdPct));
  const [preset, setPreset] = useState<Preset>(settings.defaultPreset);
  const [weekStart, setWeekStart] = useState<WeekStart>(settings.weekStart);
  const [comparison, setComparison] = useState(settings.comparisonDefault);

  const save = () => {
    const n = Number(threshold);
    const thresholdPct = Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : settings.thresholdPct;
    onSave({ thresholdPct, defaultPreset: preset, comparisonDefault: comparison, weekStart });
  };

  return (
    <div className="dm-page">
      <header className="dm-page-header gy-settings-header">
        <button type="button" className="gy-icon-btn" aria-label="Back" title="Back" onClick={onBack}><ArrowLeft size={16} /></button>
        <h1 className="dm-page-header-title">Settings</h1>
      </header>
      <div className="gy-tabs" role="tablist" aria-label="Settings">
        {TABS.map((t, i) => (
          <button
            key={t.id} type="button" role="tab" id={`gy-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`gy-panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
            ref={(el) => { tabRefs.current[t.id] = el; }} className="gy-tab" onClick={() => go(t.id)} onKeyDown={(e) => onTabKey(e, i)}
          >{t.label}</button>
        ))}
      </div>
      <main>
        <div className="dm-page-content" role="tabpanel" id="gy-panel-ontology" aria-labelledby="gy-tab-ontology" hidden={tab !== 'ontology'}>
          {ontology
            ? <OntologyTab {...ontology} onCancel={onBack} onRebuild={onRebuild} canRebuild={canRebuild} projectId={projectId} onOpen={onOpen} onDismiss={onDismiss} />
            : <><LoadingLine /><p className="dm-muted gy-form-note">Reading Data Marts…</p></>}
        </div>
        <div className="dm-page-content" role="tabpanel" id="gy-panel-checkup" aria-labelledby="gy-tab-checkup" hidden={tab !== 'checkup'}>
          {tab === 'checkup' && checkup && <CheckupTab {...checkup} onOpen={onOpen} onOpenTab={(t) => go(t)} />}
        </div>
        <div className="dm-page-content" role="tabpanel" id="gy-panel-general" aria-labelledby="gy-tab-general" hidden={tab !== 'general'}>
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
            <div className="gy-field">
              <label htmlFor="gy-week-start">Week starts on</label>
              <select id="gy-week-start" className="gy-select" value={weekStart} onChange={(e) => setWeekStart(e.target.value as WeekStart)}>
                <option value="monday">Monday</option>
                <option value="sunday">Sunday</option>
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
        </div>
      </main>
    </div>
  );
}
