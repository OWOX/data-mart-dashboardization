import { useCallback, useEffect, useState } from 'react';
import type { PluginSchedule, PluginSchedules } from '@owox/plugin-sdk';
import { PRESET_LABELS, type Model, type Settings } from '../types';
import { describeCadence, fromCron } from '../schedules/cron';
import { parseWarmInput } from '../schedules/input';
import { ownSchedules } from '../schedules/sync';
import type { CollectionsLike } from '../store/collections';
import { describeActionError } from '../lib/errors';
import { ScheduleForm } from './ScheduleForm';

const LIMIT = 20;

export interface SchedulesProps { schedules: PluginSchedules | undefined; memberId: string; model: Model | null; settings: Settings; store: CollectionsLike }

const cadenceOf = (s: PluginSchedule): string => { const c = fromCron(s.cron); return c ? describeCadence(c) : `Custom: ${s.cron}`; };

export function SchedulesTab({ schedules, memberId, model, settings, store }: SchedulesProps) {
  const [all, setAll] = useState<PluginSchedule[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [form, setForm] = useState<{ schedule: PluginSchedule | null } | null>(null);

  const load = useCallback(async () => {
    if (!schedules) return;
    setLoadError(null);
    try { setAll(await schedules.list()); } catch (e) { setLoadError(`Couldn't load schedules: ${describeActionError(e)}`); }
  }, [schedules]);
  useEffect(() => { void load(); }, [load]);

  if (!schedules) return <p className="dm-muted">Schedules need a newer version of OWOX Data Marts.</p>;
  if (loadError) return <div><p role="alert" className="gy-form-error">{loadError}</p><button type="button" className="gy-btn" onClick={() => void load()}>Retry</button></div>;
  if (!all) return <p className="dm-muted">Loading schedules…</p>;

  const act = async (fn: () => Promise<unknown>) => {
    setRowError(null);
    try { await fn(); await load(); } catch (e) { setRowError(describeActionError(e)); }
  };
  const full = all.length >= LIMIT;

  return (
    <div className="gy-schedules">
      <p className="dm-muted">{all.length} of {LIMIT} schedules used in this project</p>
      {rowError && <p role="alert" className="gy-form-error">{rowError}</p>}
      {form ? (
        <ScheduleForm schedules={schedules} schedule={form.schedule} memberId={memberId} model={model} settings={settings} store={store}
          onSaved={async () => { await load(); setForm(null); }} onCancel={() => setForm(null)} />
      ) : (
        <div>
          <button type="button" className="gy-btn gy-btn-primary" disabled={full} onClick={() => setForm({ schedule: null })}>Add schedule</button>
          {full && <span className="dm-muted gy-field-hint"> The project has {LIMIT} schedules, the most OWOX allows.</span>}
        </div>
      )}
      {ownSchedules(all, memberId).map((s) => {
        const ranges = parseWarmInput(s.parameters)?.ranges.map((r) => PRESET_LABELS[r.range.preset]).join(', ');
        return (
          <div key={s.id} className="dm-card gy-schedule">
            <strong>{s.name || cadenceOf(s)}</strong>
            {s.name && <div>{cadenceOf(s)}</div>}
            <div className="dm-muted">{s.timeZone}</div>
            <div className="dm-muted">Ranges: {ranges}</div>
            <div className="dm-muted">Next run: {s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : 'Not scheduled'}</div>
            <div className="dm-muted">Last run: {s.lastRun ? [s.lastRun.status, s.lastRun.errorCode].filter(Boolean).join(' ') : 'Never run'}</div>
            {s.disabledReason === 'PAUSED_BY_ADMIN' && <div className="gy-form-error">Paused by a project admin</div>}
            <div className="gy-form-actions">
              <label className="gy-check">
                <input type="checkbox" checked={s.enabled} onChange={() => void act(() => (s.enabled ? schedules.pause(s.id) : schedules.resume(s.id)))} />Enabled
              </label>
              <button type="button" className="gy-btn" onClick={() => setForm({ schedule: s })}>Edit</button>
              <button type="button" className="gy-btn" onClick={() => { if (window.confirm('Delete this schedule?')) void act(() => schedules.delete(s.id)); }}>Delete</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
