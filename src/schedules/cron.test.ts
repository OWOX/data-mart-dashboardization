import { CADENCE_PRESETS, describeCadence, fromCron, toCron, type Cadence } from './cron';

test.each<[Cadence, string]>([
  [{ type: 'daily', time: '09:30' }, '30 9 * * *'],
  [{ type: 'weekly', time: '09:00', weekdays: [5, 1, 3] }, '0 9 * * 1,3,5'],
  [{ type: 'monthly', time: '00:05', days: [15, 1] }, '5 0 1,15 * *'],
  [{ type: 'interval', unit: 'minutes', every: 15 }, '*/15 * * * *'],
  [{ type: 'interval', unit: 'hours', every: 6 }, '0 */6 * * *'],
])('%o is %s and parses back', (c, cron) => {
  expect(toCron(c)).toBe(cron);
  const back = fromCron(cron)!;
  expect(toCron(back)).toBe(cron);
});

test('the presets are the Data Mart ones', () => {
  expect(CADENCE_PRESETS.map((p) => [p.label, toCron(p.cadence)])).toEqual([
    ['Weekdays 9:00', '0 9 * * 1,2,3,4,5'], ['Every hour', '0 */1 * * *'], ['Every 6 hours', '0 */6 * * *'],
  ]);
});

test.each(['', '0 9 * *', '0 9 * 1 *', '0 9 1 * 1', '*/7 * * * *', '0 */5 * * *', '61 9 * * *', '0 24 * * *', '0 9 * * 8', '0 9 32 * *', 'a b c d e'])('%s is not a cadence', (cron) => {
  expect(fromCron(cron)).toBeNull();
});

test('a weekly cadence without weekdays or a monthly one without days has no cron', () => {
  expect(() => toCron({ type: 'weekly', time: '09:00', weekdays: [] })).toThrow();
  expect(() => toCron({ type: 'monthly', time: '09:00', days: [] })).toThrow();
});

test('cadences read in words', () => {
  expect(describeCadence({ type: 'daily', time: '09:30' })).toBe('Daily at 09:30');
  expect(describeCadence({ type: 'weekly', time: '09:00', weekdays: [1, 2, 3, 4, 5] })).toBe('Weekly on Monday, Tuesday, Wednesday, Thursday, Friday at 09:00');
  expect(describeCadence({ type: 'monthly', time: '09:00', days: [1, 15] })).toBe('Monthly on the 1st and 15th at 09:00');
  expect(describeCadence({ type: 'interval', unit: 'hours', every: 1 })).toBe('Every hour');
  expect(describeCadence({ type: 'interval', unit: 'minutes', every: 30 })).toBe('Every 30 minutes');
  expect(describeCadence({ type: 'monthly', time: '06:00', days: [22, 2, 11, 1] })).toBe('Monthly on the 1st, 2nd, 11th, and 22nd at 06:00');
});
