import { useState } from 'react';
import type { PluginSchedule, PluginSchedules } from '@owox/plugin-sdk';
import { PRESET_GROUPS, PRESET_LABELS, type Model, type Preset, type Settings } from '../types';
import { CADENCE_PRESETS, HOUR_INTERVALS, MINUTE_INTERVALS, WEEKDAYS, fromCron, toCron, type Cadence } from '../schedules/cron';
import { MAX_RANGES, WARM_ACTION, parseWarmInput, rangesFor } from '../schedules/input';
import { writeSnapshot } from '../schedules/snapshot';
import type { CollectionsLike } from '../store/collections';
import { describeActionError } from '../lib/errors';

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const TYPES: { id: Cadence['type']; label: string }[] = [{ id: 'daily', label: 'Daily' }, { id: 'weekly', label: 'Weekly' }, { id: 'monthly', label: 'Monthly' }, { id: 'interval', label: 'Interval' }];

const browserZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
let zoneList: string[] | null = null;
function zones(): string[] {
  if (zoneList) return zoneList;
  zoneList = computeZones();
  return zoneList;
}
function computeZones(): string[] {
  const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  try { if (fn) return fn('timeZone'); } catch { /* fall back below */ }
  return [...new Set([browserZone(), 'UTC'])];
}

const toggle = <T,>(xs: T[], x: T): T[] => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

export interface ScheduleFormProps {
  schedules: PluginSchedules; schedule: PluginSchedule | null; memberId: string; model: Model | null; settings: Settings; store: CollectionsLike;
  onSaved: () => void | Promise<void>; onCancel: () => void;
}

export function ScheduleForm({ schedules, schedule, memberId, model, settings, store, onSaved, onCancel }: ScheduleFormProps) {
  const parsed = schedule ? fromCron(schedule.cron) : null;
  const raw = !!schedule && !parsed;
  const start: Cadence = parsed ?? { type: 'daily', time: '09:00' };
  const [name, setName] = useState(schedule?.name ?? '');
  const [type, setType] = useState<Cadence['type']>(start.type);
  const [time, setTime] = useState('time' in start ? start.time : '09:00');
  const [weekdays, setWeekdays] = useState<number[]>(start.type === 'weekly' ? start.weekdays : [1, 2, 3, 4, 5]);
  const [days, setDays] = useState<number[]>(start.type === 'monthly' ? start.days : [1]);
  const [unit, setUnit] = useState<'minutes' | 'hours'>(start.type === 'interval' ? start.unit : 'hours');
  const [every, setEvery] = useState(start.type === 'interval' ? start.every : 1);
  const [zone, setZone] = useState(schedule?.timeZone ?? browserZone());
  const [enabled, setEnabled] = useState(true);
  const [picked, setPicked] = useState<Preset[]>(() => {
    const input = schedule ? parseWarmInput(schedule.parameters) : null;
    return input ? input.ranges.map((r) => r.range.preset) : [];
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cadence = (): Cadence => type === 'daily' ? { type, time } : type === 'weekly' ? { type, time, weekdays } : type === 'monthly' ? { type, time, days } : { type, unit, every };
  const applyPreset = (c: Cadence) => {
    setType(c.type);
    if (c.type === 'interval') { setUnit(c.unit); setEvery(c.every); return; }
    setTime(c.time);
    if (c.type === 'weekly') setWeekdays(c.weekdays);
    if (c.type === 'monthly') setDays(c.days);
  };
  const timeZones = zones().includes(zone) ? zones() : [zone, ...zones()];
  const intervals = unit === 'minutes' ? MINUTE_INTERVALS : HOUR_INTERVALS;

  const save = async () => {
    setError(null);
    if (!model) { setError('Build the model first: a schedule warms the Data Marts of your model.'); return; }
    let cron: string;
    try { cron = raw ? schedule!.cron : toCron(cadence()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    setBusy(true);
    try {
      const martIds = await writeSnapshot(store, model, memberId);
      const parameters = { memberId, martIds, ranges: rangesFor(picked, settings) };
      if (schedule) await schedules.update(schedule.id, { parameters, cron, timeZone: zone, name: name || null });
      else await schedules.create({ action: WARM_ACTION, parameters, cron, timeZone: zone, name, enabled });
      await onSaved();
    } catch (e) {
      setError(describeActionError(e));
      setBusy(false);
    }
  };

  return (
    <form className="dm-card gy-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="gy-field">
        <label htmlFor="gy-sch-name">Name</label>
        <input id="gy-sch-name" className="gy-input gy-input-wide" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        <span className="dm-muted gy-field-hint">Optional</span>
      </div>
      {raw ? <p className="dm-muted">Cron: {schedule!.cron}</p> : (
        <>
          <div className="gy-chips" role="group" aria-label="Presets">
            {CADENCE_PRESETS.map((p) => <button key={p.label} type="button" className="gy-chip" onClick={() => applyPreset(p.cadence)}>{p.label}</button>)}
          </div>
          <div className="gy-field">
            <label htmlFor="gy-sch-type">Type</label>
            <select id="gy-sch-type" className="gy-select" value={type} onChange={(e) => setType(e.target.value as Cadence['type'])}>
              {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          {type !== 'interval' && (
            <div className="gy-field">
              <label htmlFor="gy-sch-time">Time</label>
              <input id="gy-sch-time" className="gy-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          )}
          {type === 'weekly' && (
            <fieldset className="gy-field gy-checks"><legend>Days of the week</legend>
              {WEEKDAYS.map((d) => <label key={d.value} className="gy-check"><input type="checkbox" checked={weekdays.includes(d.value)} onChange={() => setWeekdays(toggle(weekdays, d.value))} />{d.label}</label>)}
            </fieldset>
          )}
          {type === 'monthly' && (
            <fieldset className="gy-field gy-checks"><legend>Days of the month</legend>
              {DAYS.map((d) => <label key={d} className="gy-check"><input type="checkbox" checked={days.includes(d)} onChange={() => setDays(toggle(days, d))} />{d}</label>)}
            </fieldset>
          )}
          {type === 'interval' && (
            <>
              <div className="gy-field">
                <label htmlFor="gy-sch-unit">Unit</label>
                <select id="gy-sch-unit" className="gy-select" value={unit} onChange={(e) => { const u = e.target.value as 'minutes' | 'hours'; setUnit(u); setEvery((u === 'minutes' ? MINUTE_INTERVALS : HOUR_INTERVALS)[0]!); }}>
                  <option value="minutes">Minutes</option><option value="hours">Hours</option>
                </select>
              </div>
              <div className="gy-field">
                <label htmlFor="gy-sch-every">Every</label>
                <select id="gy-sch-every" className="gy-select" value={every} onChange={(e) => setEvery(Number(e.target.value))}>
                  {intervals.map((n) => <option key={n} value={n}>{n} {unit === 'minutes' ? 'min' : 'h'}</option>)}
                </select>
              </div>
            </>
          )}
        </>
      )}
      <div className="gy-field">
        <label htmlFor="gy-sch-zone">Time zone</label>
        <select id="gy-sch-zone" className="gy-select" value={zone} onChange={(e) => setZone(e.target.value)}>
          {timeZones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
      </div>
      {!schedule && <label className="gy-check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Enabled</label>}
      <fieldset className="gy-field"><legend>Data ranges</legend>
        {PRESET_GROUPS.map((g) => (
          <div key={g.label} className="gy-checks"><span className="dm-muted">{g.label}</span>
            {g.presets.map((p) => (
              <label key={p} className="gy-check">
                <input type="checkbox" checked={picked.includes(p)} disabled={!picked.includes(p) && picked.length >= MAX_RANGES} onChange={() => setPicked(toggle(picked, p))} />{PRESET_LABELS[p]}
              </label>
            ))}
          </div>
        ))}
        <span className="dm-muted gy-field-hint">None picked: your default range, {PRESET_LABELS[settings.defaultPreset]}</span>
      </fieldset>
      {error && <p role="alert" className="gy-form-error">{error}</p>}
      <div className="gy-form-actions">
        <button type="submit" className="gy-btn gy-btn-primary" disabled={busy}>Save</button>
        <button type="button" className="gy-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
