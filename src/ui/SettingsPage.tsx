import { useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react';
import { ArrowLeft } from 'lucide-react';
import { PRESET_GROUPS, PRESET_LABELS, type BuildResult, type Model, type Preset, type Settings, type WeekStart } from '../types';
import type { MartDetail, OwoxLike } from '../owox/sources';
import type { BuildStep } from '../model/build';
import { LoadingBar } from './LoadingBar';
import { OntologyTab } from './OntologyTab';
import { CheckupTab, type CheckupProps } from './CheckupTab';

export type SettingsTab = 'general' | 'ontology' | 'checkup';
const TABS: { id: SettingsTab; label: string }[] = [{ id: 'general', label: 'General' }, { id: 'ontology', label: 'Metrics' }, { id: 'checkup', label: 'Checkup' }];

/** What the Metrics tab edits; null while the Data Marts are still being read. */
export interface OntologyProps {
  model: Model;
  details: ReadonlyMap<string, MartDetail>;
  marts: { id: string; title: string; icon?: string | null }[] | null;
  owox: OwoxLike;
  now: () => Date;
  onSave: (m: Model) => Promise<void>;
  hashOf?: (m: Model) => Promise<string | null>;
  /** Data Marts the health check confirmed are gone. */
  gone?: ReadonlySet<string>;
}

export function SettingsPage({ settings, onSave, onBack, onRebuild, canRebuild = true, projectId, onOpen, onDismiss, error, tab: initialTab = 'general', onTabChange, ontology, checkup, noModel = false, isAdmin = true, onReload, rebuildRef }: {
  settings: Settings; onSave: (s: Settings) => void; onBack: () => void;
  /** Reads the descriptions and schemas again into a candidate model; the Ontology tab shows it as a proposal. */
  onRebuild?: (onStep: (s: BuildStep) => void) => Promise<BuildResult>; canRebuild?: boolean; projectId?: string; onOpen?: (path: string) => void;
  /** A proposal was discarded: the canvas stops calling the model out of date against the hash it checked. */
  onDismiss?: () => void; error?: string | null;
  tab?: SettingsTab; onTabChange?: (t: SettingsTab) => void; ontology?: OntologyProps | null;
  /** What the Checkup tab runs; the tab stays mounted, and each time it becomes active it starts a run. */
  checkup?: Omit<CheckupProps, 'isAdmin' | 'noModel' | 'active' | 'metricsDirty' | 'onOpenTab'> | null;
  /** Filled with a function that starts the Metrics tab's Rebuild. */
  rebuildRef?: MutableRefObject<(() => void) | null>;
  /** No model yet: the Metrics tab says so instead of waiting for Data Marts. */
  noModel?: boolean;
  /** A member who isn't a project admin reads the model and edits only their own view settings. */
  isAdmin?: boolean;
  /** Reloads the shared model after a save found it changed by someone else. */
  onReload?: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [metricsDirty, setMetricsDirty] = useState(false);
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
  const [preset, setPreset] = useState<Preset | null>(settings.defaultPreset);
  const [weekStart, setWeekStart] = useState<WeekStart>(settings.weekStart);
  const [comparison, setComparison] = useState(settings.comparisonDefault);

  const save = () => {
    const n = Number(threshold);
    const thresholdPct = Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : settings.thresholdPct;
    onSave({ ...settings, thresholdPct, defaultPreset: preset, comparisonDefault: comparison, weekStart });
  };

  const metrics = ontology
    ? <OntologyTab {...ontology} onCancel={onBack} onRebuild={onRebuild} canRebuild={canRebuild} projectId={projectId} onOpen={onOpen} onDismiss={onDismiss} readOnly={!isAdmin} onReload={onReload} rebuildRef={rebuildRef} onDirty={setMetricsDirty} />
    : noModel ? <p className="dm-muted gy-form-note">No model yet. It&apos;s built when you go back to the canvas.</p>
    : <><LoadingBar /><p className="dm-muted gy-form-note">Reading Data Marts…</p></>;

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
          {/* always mounted, so an unsaved draft survives a visit to another tab */}
          {metrics}
        </div>
        <div className="dm-page-content" role="tabpanel" id="gy-panel-checkup" aria-labelledby="gy-tab-checkup" hidden={tab !== 'checkup'}>
          {/* mounted once there is a checkup; each visit starts a run */}
          {checkup && (
            <CheckupTab {...checkup} active={tab === 'checkup'} onOpen={onOpen} onOpenTab={(t) => { go(t); tabRefs.current[t]?.focus(); }} isAdmin={isAdmin} noModel={noModel} metricsDirty={metricsDirty} />
          )}
        </div>
        <div className="dm-page-content" role="tabpanel" id="gy-panel-general" aria-labelledby="gy-tab-general" hidden={tab !== 'general'}>
          <form className="dm-card gy-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <fieldset className="gy-fieldset">
              <legend>Your view</legend>
              <div className="gy-field">
                <label htmlFor="gy-default-range">Default date range</label>
                <select id="gy-default-range" className="gy-select" value={preset ?? ''} onChange={(e) => setPreset(e.target.value === '' ? null : e.target.value as Preset)}>
                  <option value="">None (ontology view)</option>
                  {PRESET_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.presets.map((p) => <option key={p} value={p}>{PRESET_LABELS[p]}</option>)}
                    </optgroup>
                  ))}
                </select>
                <span className="dm-muted gy-field-hint">Only for you</span>
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
            </fieldset>
            <fieldset className="gy-fieldset">
              <legend>Project</legend>
              <p className="dm-muted gy-form-note">This applies to everyone in the project.</p>
              <div className="gy-field">
                <label htmlFor="gy-threshold">Red when below plan by more than (%)</label>
                <input id="gy-threshold" className="gy-input" type="number" min={1} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} disabled={!isAdmin} />
                <span className="dm-muted gy-field-hint">{isAdmin ? 'A card between plan and this threshold shows orange.' : 'Only a project admin can change this'}</span>
              </div>
            </fieldset>
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
