import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Zap } from 'lucide-react';
import type { PluginSchedule, PluginSchedules } from '@owox/plugin-sdk';
import { PRESET_GROUPS, PRESET_LABELS, type Model, type Preset, type Settings } from '../types';
import { CADENCE_PRESETS, HOUR_INTERVALS, MINUTE_INTERVALS, WEEKDAYS, describeCadence, fromCron, ordinal, toCron, type Cadence } from '../schedules/cron';
import { MAX_RANGES, WARM_ACTION, parseWarmInput, rangesFor } from '../schedules/input';
import { describeActionError } from '../lib/errors';
import { MultiSelect } from './MultiSelect';
import { Select } from './Select';
import { Switch } from './Switch';

const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: ordinal(i + 1) }));
const TYPES: { value: Cadence['type']; label: string }[] = [{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'interval', label: 'Interval' }];
const RANGE_OPTIONS = PRESET_GROUPS.flatMap((g) => g.presets.map((p) => ({ value: p, label: PRESET_LABELS[p], group: g.label })));

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

interface ScheduleFormProps {
  schedules: PluginSchedules; schedule: PluginSchedule | null; model: Model | null; settings: Settings;
  onSaved: () => void | Promise<void>; onCancel: () => void;
}

/** The body and footer of the schedule sheet: the fields as OWOX's ScheduleConfig lays them out, then Save and Cancel. */
export function ScheduleForm({ schedules, schedule, model, settings, onSaved, onCancel }: ScheduleFormProps) {
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
  // the chip that was just applied shows a check for half a second, as OWOX's preset chips do
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const cadence = (): Cadence => type === 'daily' ? { type, time } : type === 'weekly' ? { type, time, weekdays } : type === 'monthly' ? { type, time, days } : { type, unit, every };
  const applyPreset = (label: string, c: Cadence) => {
    setType(c.type);
    if (c.type === 'interval') { setUnit(c.unit); setEvery(c.every); } else {
      setTime(c.time);
      if (c.type === 'weekly') setWeekdays(c.weekdays);
      if (c.type === 'monthly') setDays(c.days);
    }
    setFlash(label);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 500);
  };
  const timeZones = useMemo(() => (zones().includes(zone) ? zones() : [zone, ...zones()]).map((z) => ({ value: z, label: z })), [zone]);
  const intervals = unit === 'minutes' ? MINUTE_INTERVALS : HOUR_INTERVALS;
  const missingDays = (type === 'weekly' && weekdays.length === 0) || (type === 'monthly' && days.length === 0);
  const summary = raw ? `Cron: ${schedule!.cron}` : missingDays ? 'Pick at least one day' : describeCadence(cadence());

  const save = async () => {
    setError(null);
    if (!model) { setError('Build the model first: a schedule warms the Data Marts of your model.'); return; }
    let cron: string;
    try { cron = raw ? schedule!.cron : toCron(cadence()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    setBusy(true);
    try {
      const parameters = { ranges: rangesFor(picked, settings) };
      if (schedule) await schedules.update(schedule.id, { parameters, cron, timeZone: zone, name: name || null });
      else await schedules.create({ action: WARM_ACTION, parameters, cron, timeZone: zone, name, enabled });
      await onSaved();
    } catch (e) {
      setError(describeActionError(e));
      setBusy(false);
    }
  };

  const zoneField = (
    <div className="gy-field gy-grow">
      <span className="gy-label">Timezone</span>
      <Select label="Timezone" value={zone} options={timeZones} onChange={setZone} />
    </div>
  );

  return (
    <form className="gy-sheet-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="gy-sheet-body">
        <div className="gy-field">
          <label className="gy-label" htmlFor="gy-sch-name">Name</label>
          <input id="gy-sch-name" className="gy-input gy-input-wide" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
          <span className="dm-muted gy-field-hint">Optional</span>
        </div>
        <div className="gy-sched-box">
          {!schedule && (
            <div className="gy-switch-row">
              <Switch id="gy-sch-enabled" checked={enabled} onChange={setEnabled} />
              <label htmlFor="gy-sch-enabled">Enabled</label>
            </div>
          )}
          {raw ? (
            <>
              <p className="dm-muted gy-sched-raw">{summary}</p>
              {zoneField}
            </>
          ) : (
            <>
              <div className="gy-field">
                <div className="gy-field-head">
                  <span className="gy-label">Type</span>
                  <div className="gy-presets" role="group" aria-label="Presets">
                    {CADENCE_PRESETS.map((p) => (
                      <button key={p.label} type="button" className="gy-preset" onClick={() => applyPreset(p.label, p.cadence)}>
                        <Zap size={12} aria-hidden="true" className="gy-preset-icon" data-hide={flash === p.label} />
                        <Check size={12} aria-hidden="true" className="gy-preset-icon" data-hide={flash !== p.label} />
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Select label="Type" value={type} options={TYPES} onChange={(v) => setType(v as Cadence['type'])} />
              </div>
              {type !== 'interval' && (
                <div className="gy-frow">
                  <div className="gy-field">
                    <label className="gy-label" htmlFor="gy-sch-time">Time</label>
                    <input id="gy-sch-time" className="gy-input gy-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                  </div>
                  {zoneField}
                </div>
              )}
              {type === 'weekly' && (
                <div className="gy-field">
                  <span className="gy-label">Days of week</span>
                  <MultiSelect label="Days of week" value={weekdays} options={WEEKDAYS} onChange={setWeekdays} placeholder="Select days…" />
                </div>
              )}
              {type === 'monthly' && (
                <div className="gy-field">
                  <span className="gy-label">Days of month</span>
                  <MultiSelect label="Days of month" value={days} options={MONTH_DAYS} onChange={setDays} placeholder="Select days…" maxShown={4} />
                </div>
              )}
              {type === 'interval' && (
                <>
                  <div className="gy-frow gy-frow-even">
                    <div className="gy-field">
                      <span className="gy-label">Unit</span>
                      <Select label="Unit" value={unit} options={[{ value: 'minutes', label: 'Minutes' }, { value: 'hours', label: 'Hours' }]} onChange={(v) => { const u = v as 'minutes' | 'hours'; setUnit(u); setEvery((u === 'minutes' ? MINUTE_INTERVALS : HOUR_INTERVALS)[0]!); }} />
                    </div>
                    <div className="gy-field">
                      <span className="gy-label">Every</span>
                      <Select label="Every" value={String(every)} options={intervals.map((n) => ({ value: String(n), label: `${n} ${unit === 'minutes' ? 'min' : 'hr'}` }))} onChange={(v) => setEvery(Number(v))} />
                    </div>
                  </div>
                  {zoneField}
                </>
              )}
            </>
          )}
          {!raw && (
            <p className="gy-sched-preview" aria-live="polite">
              <span className="gy-sched-preview-k">Schedule</span>
              <span>{summary}</span>
            </p>
          )}
        </div>
        <div className="gy-field">
          <span className="gy-label">Data ranges</span>
          <MultiSelect label="Data ranges" value={picked} options={RANGE_OPTIONS} onChange={setPicked} max={MAX_RANGES} maxShown={2} placeholder={`Default range, ${PRESET_LABELS[settings.defaultPreset]}`} describedBy="gy-sch-ranges-hint" />
          <span id="gy-sch-ranges-hint" className="dm-muted gy-field-hint">None picked: your default range, {PRESET_LABELS[settings.defaultPreset]}</span>
        </div>
      </div>
      <div className="gy-sheet-footer">
        {error && <p role="alert" className="gy-form-error">{error}</p>}
        <button type="submit" className="gy-btn gy-btn-primary gy-btn-block" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="gy-btn gy-btn-block" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
