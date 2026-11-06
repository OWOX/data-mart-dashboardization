/** The cadences the Schedules form offers, the same as Data Mart schedules; anything else stays raw cron. */
export type Cadence =
  | { type: 'daily'; time: string }
  | { type: 'weekly'; time: string; weekdays: number[] }
  | { type: 'monthly'; time: string; days: number[] }
  | { type: 'interval'; unit: 'minutes' | 'hours'; every: number };

export const MINUTE_INTERVALS = [5, 10, 15, 30];
export const HOUR_INTERVALS = [1, 2, 3, 4, 6, 8, 12];
// cron numbers the days from Sunday = 0; the form lists Monday first
export const WEEKDAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
];

export const CADENCE_PRESETS: { label: string; cadence: Cadence }[] = [
  { label: 'Weekdays 9:00', cadence: { type: 'weekly', time: '09:00', weekdays: [1, 2, 3, 4, 5] } },
  { label: 'Every hour', cadence: { type: 'interval', unit: 'hours', every: 1 } },
  { label: 'Every 6 hours', cadence: { type: 'interval', unit: 'hours', every: 6 } },
];

const hm = (time: string): [number, number] => {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  const h = m ? Number(m[1]) : NaN;
  const min = m ? Number(m[2]) : NaN;
  if (!(h >= 0 && h <= 23 && min >= 0 && min <= 59)) throw new Error(`Invalid time ${time}`);
  return [h, min];
};
const list = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b).join(',');

export function toCron(c: Cadence): string {
  if (c.type === 'interval') return c.unit === 'minutes' ? `*/${c.every} * * * *` : `0 */${c.every} * * *`;
  const [h, m] = hm(c.time);
  if (c.type === 'daily') return `${m} ${h} * * *`;
  if (c.type === 'weekly') { if (!c.weekdays.length) throw new Error('Pick at least one day'); return `${m} ${h} * * ${list(c.weekdays)}`; }
  if (!c.days.length) throw new Error('Pick at least one day');
  return `${m} ${h} ${list(c.days)} * *`;
}

const num = (s: string, lo: number, hi: number): number | null => (/^\d{1,2}$/.test(s) && Number(s) >= lo && Number(s) <= hi ? Number(s) : null);
const nums = (s: string, lo: number, hi: number): number[] | null => {
  const xs = s.split(',').map((x) => num(x, lo, hi));
  return xs.every((x) => x !== null) ? (xs as number[]) : null;
};
const pad = (n: number) => String(n).padStart(2, '0');

export function fromCron(cron: string): Cadence | null {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [mi, ho, dom, mon, dow] = f as [string, string, string, string, string];
  if (mon !== '*') return null;
  const every = /^\*\/(\d+)$/;
  const em = every.exec(mi);
  if (em && ho === '*' && dom === '*' && dow === '*') { const n = Number(em[1]); return MINUTE_INTERVALS.includes(n) ? { type: 'interval', unit: 'minutes', every: n } : null; }
  const eh = every.exec(ho);
  if (eh && mi === '0' && dom === '*' && dow === '*') { const n = Number(eh[1]); return HOUR_INTERVALS.includes(n) ? { type: 'interval', unit: 'hours', every: n } : null; }
  const m = num(mi, 0, 59);
  const h = num(ho, 0, 23);
  if (m === null || h === null) return null;
  const time = `${pad(h)}:${pad(m)}`;
  if (dom === '*' && dow === '*') return { type: 'daily', time };
  if (dom === '*') { const weekdays = nums(dow, 0, 6); return weekdays ? { type: 'weekly', time, weekdays } : null; }
  if (dow === '*') { const days = nums(dom, 1, 31); return days ? { type: 'monthly', time, days } : null; }
  return null;
}

export function describeCadence(c: Cadence): string {
  if (c.type === 'interval') return c.every === 1 ? `Every ${c.unit === 'hours' ? 'hour' : 'minute'}` : `Every ${c.every} ${c.unit}`;
  if (c.type === 'daily') return `Every day at ${c.time}`;
  if (c.type === 'weekly') return `${WEEKDAYS.filter((d) => c.weekdays.includes(d.value)).map((d) => d.label).join(', ')} at ${c.time}`;
  return `Day ${[...c.days].sort((a, b) => a - b).join(', ')} of each month at ${c.time}`;
}
