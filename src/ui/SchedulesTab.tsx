import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import type { PluginSchedule, PluginSchedules } from '@owox/plugin-sdk';
import { PRESET_LABELS, type Model, type Settings } from '../types';
import { describeCadence, fromCron } from '../schedules/cron';
import { WARM_ACTION, parseWarmInput } from '../schedules/input';
import { describeActionError } from '../lib/errors';
import { ScheduleForm } from './ScheduleForm';
import { RowMenu } from './RowMenu';
import { Sheet } from './Sheet';
import { Switch } from './Switch';

const LIMIT = 20;

export interface SchedulesProps { schedules: PluginSchedules | undefined; model: Model | null; settings: Settings }

const cadenceOf = (s: PluginSchedule): string => { const c = fromCron(s.cron); return c ? describeCadence(c) : `Custom: ${s.cron}`; };

// date and time to the minute, in the viewer's own time zone and language
const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const whenOf = (iso: string): string | null => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : when.format(d); };

type RunStatus = NonNullable<PluginSchedule['lastRun']>['status'];
const STATUS: Record<RunStatus, { label: string; tone: 'ok' | 'bad' | 'warn' | 'busy' | 'idle' }> = {
  SUCCEEDED: { label: 'Succeeded', tone: 'ok' }, FAILED: { label: 'Failed', tone: 'bad' }, RUNNING: { label: 'Running', tone: 'busy' },
  QUEUED: { label: 'Queued', tone: 'idle' }, CANCELLED: { label: 'Cancelled', tone: 'idle' }, TIMED_OUT: { label: 'Timed out', tone: 'warn' },
};

function LastRun({ run }: { run: PluginSchedule['lastRun'] }) {
  if (!run) return <span className="dm-muted">Never run</span>;
  const status = STATUS[run.status] ?? { label: run.status, tone: 'idle' as const };
  const at = run.finishedAt ? whenOf(run.finishedAt) : null;
  return (
    <div className="gy-lastrun">
      <div className="gy-lastrun-line">
        <span className="gy-status" data-tone={status.tone}>{status.label}</span>
        {run.errorCode && <code className="gy-code">{run.errorCode}</code>}
      </div>
      {at && <time className="dm-muted gy-when" dateTime={run.finishedAt!}>{at}</time>}
    </div>
  );
}

export function SchedulesTab({ schedules, model, settings }: SchedulesProps) {
  const [all, setAll] = useState<PluginSchedule[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [form, setForm] = useState<{ schedule: PluginSchedule | null; returnTo: HTMLElement | null } | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const menuButtons = useRef(new Map<string, HTMLButtonElement>());

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
  const toggle = (s: PluginSchedule) => void act(() => (s.enabled ? schedules.pause(s.id) : schedules.resume(s.id)));
  const remove = (s: PluginSchedule) => { if (window.confirm('Delete this schedule?')) void act(() => schedules.delete(s.id)); };
  const edit = (s: PluginSchedule) => setForm({ schedule: s, returnTo: menuButtons.current.get(s.id) ?? null });
  // OWOX lists only this member's schedules, so the count and the limit are the member's own
  const full = all.length >= LIMIT;
  const rows = all.filter((s) => s.action === WARM_ACTION);
  const add = (
    <button type="button" ref={addButton} className="gy-btn gy-btn-primary gy-btn-icon" disabled={full} onClick={() => setForm({ schedule: null, returnTo: addButton.current })}>
      <Plus size={16} aria-hidden="true" />Add schedule
    </button>
  );

  return (
    <div className="gy-schedules">
      <div className="gy-sched-bar">
        <p className="dm-muted gy-sched-count">{all.length} of {LIMIT} schedules</p>
        <div className="gy-sched-add">
          {full && <span className="dm-muted gy-field-hint">You have {LIMIT} schedules, the most OWOX allows.</span>}
          {add}
        </div>
      </div>
      {rowError && <p role="alert" className="gy-form-error">{rowError}</p>}
      <div className="gy-table-scroll">
        <table className="gy-table" aria-label="Schedules">
          <thead>
            <tr>
              <th scope="col" className="gy-col-enabled">Enabled</th>
              <th scope="col">Schedule</th>
              <th scope="col">Data ranges</th>
              <th scope="col">Next run</th>
              <th scope="col">Last run</th>
              <th scope="col" className="gy-col-actions"><span className="gy-sr">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr className="gy-empty-row">
                <td colSpan={6}>
                  <div className="gy-empty-state" role="status">
                    <p className="dm-muted gy-empty-title">Create your first schedule</p>
                    <button type="button" className="gy-btn gy-btn-icon" disabled={full} onClick={() => setForm({ schedule: null, returnTo: addButton.current })}>
                      <Plus size={16} aria-hidden="true" />New schedule
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {rows.map((s) => {
              const ranges = parseWarmInput(s.parameters)?.ranges.map((r) => PRESET_LABELS[r.range.preset]) ?? [];
              const next = s.nextRunAt ? whenOf(s.nextRunAt) : null;
              const title = s.name || cadenceOf(s);
              const nameId = `gy-sch-${s.id}-name`;
              return (
                <tr key={s.id} className="gy-row" data-off={!s.enabled || undefined} onClick={() => edit(s)}>
                  <td className="gy-col-enabled" onClick={(e) => e.stopPropagation()}>
                    <Switch checked={s.enabled} onChange={() => toggle(s)} label="Enabled" describedBy={nameId} />
                  </td>
                  <td>
                    <div id={nameId}>
                      {s.name ? <><strong className="gy-sched-name">{s.name}</strong><div>{cadenceOf(s)}</div></> : <div>{cadenceOf(s)}</div>}
                    </div>
                    <code className="gy-code gy-tz">{s.timeZone}</code>
                    {s.disabledReason === 'PAUSED_BY_ADMIN' && <div className="gy-form-error gy-sched-flag">Paused by a project admin</div>}
                  </td>
                  <td>
                    {ranges.length ? <div className="gy-tags">{ranges.map((r, i) => <span key={i} className="gy-tag gy-tag-plain">{r}</span>)}</div> : <span className="dm-muted">-</span>}
                  </td>
                  <td>
                    {next ? <time className="gy-when" dateTime={s.nextRunAt!}>{next}</time> : <span className="dm-muted">Not scheduled</span>}
                  </td>
                  <td><LastRun run={s.lastRun} /></td>
                  <td className="gy-col-actions" onClick={(e) => e.stopPropagation()}>
                    <RowMenu
                      label={`Actions for ${title}`}
                      rowId={s.id} buttons={menuButtons.current}
                      items={[
                        { label: 'Edit schedule', icon: Pencil, onSelect: () => edit(s) },
                        s.enabled ? { label: 'Pause schedule', icon: Pause, onSelect: () => toggle(s) } : { label: 'Resume schedule', icon: Play, onSelect: () => toggle(s) },
                        { label: 'Delete schedule', icon: Trash2, danger: true, onSelect: () => remove(s) },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {form && (
        <Sheet
          title={form.schedule ? 'Edit schedule' : 'Add schedule'}
          description="Warm the cached data of your model's Data Marts on a schedule."
          returnTo={form.returnTo} onClose={() => setForm(null)}
        >
          <ScheduleForm schedules={schedules} schedule={form.schedule} model={model} settings={settings}
            onSaved={async () => { await load(); setForm(null); }} onCancel={() => setForm(null)} />
        </Sheet>
      )}
    </div>
  );
}
