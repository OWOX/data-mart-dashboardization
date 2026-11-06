import type { PluginSchedule, PluginSchedules } from '@owox/plugin-sdk';
import { render, screen, fireEvent, waitFor } from '../test-host';
import { SchedulesTab } from './SchedulesTab';
import { DEFAULT_SETTINGS } from '../types';
import { model as fixtureModel } from '../test/fixtures';

function fakeSchedules(initial: PluginSchedule[] = []) {
  let rows = [...initial];
  let n = 0;
  const api: PluginSchedules = {
    list: vi.fn(async () => rows),
    get: vi.fn(async (id: string) => rows.find((r) => r.id === id)!),
    create: vi.fn(async (s) => { const row: PluginSchedule = { id: `s${++n}`, name: s.name ?? null, action: s.action, parameters: s.parameters, cron: s.cron, timeZone: s.timeZone, enabled: s.enabled ?? true, disabledReason: null, nextRunAt: null, lastRun: null, createdAt: '', modifiedAt: '' }; rows.push(row); return row; }),
    update: vi.fn(async (id, patch) => { rows = rows.map((r) => (r.id === id ? { ...r, ...patch, name: patch.name === undefined ? r.name : patch.name } : r)); return rows.find((r) => r.id === id)!; }),
    pause: vi.fn(async (id) => { rows = rows.map((r) => (r.id === id ? { ...r, enabled: false } : r)); return rows.find((r) => r.id === id)!; }),
    resume: vi.fn(async (id) => { rows = rows.map((r) => (r.id === id ? { ...r, enabled: true } : r)); return rows.find((r) => r.id === id)!; }),
    delete: vi.fn(async (id) => { rows = rows.filter((r) => r.id !== id); }),
  };
  return api;
}
const range = { range: { kind: 'preset', preset: 'qtd' }, compare: { kind: 'off' }, weekStart: 'monday' };
const row = (id: string, extra: Partial<PluginSchedule> = {}): PluginSchedule => ({
  id, name: null, action: 'warm-cache', parameters: { ranges: [range] }, cron: '0 9 * * 1,2,3,4,5', timeZone: 'UTC',
  enabled: true, disabledReason: null, nextRunAt: null, lastRun: null, createdAt: '', modifiedAt: '', ...extra,
});
beforeEach(() => { window.confirm = vi.fn(() => true); });
afterEach(() => { delete (window as { confirm?: unknown }).confirm; });

const props = (schedules: PluginSchedules | undefined, extra = {}) => ({ schedules, model: fixtureModel, settings: DEFAULT_SETTINGS, ...extra });

test('without ctx.schedules the tab says OWOX is too old', () => {
  render(<SchedulesTab {...props(undefined)} />);
  expect(screen.getByText(/need a newer version/)).toBeInTheDocument();
});

test('lists every warm-cache schedule, one with unreadable parameters too, and counts all of them', async () => {
  render(<SchedulesTab {...props(fakeSchedules([row('a'), row('b', { action: 'other' }), row('c', { parameters: { junk: true }, cron: '0 6 * * *' })]))} />);
  expect(await screen.findByText('3 of 20 schedules')).toBeInTheDocument();
  expect(screen.getByText('Mon, Tue, Wed, Thu, Fri at 09:00')).toBeInTheDocument();
  expect(screen.getByText('Every day at 06:00')).toBeInTheDocument();
  expect(screen.getAllByText(/^Ranges:/)).toHaveLength(1);
});

test('a schedule with unreadable parameters is saved with fresh ones', async () => {
  const api = fakeSchedules([row('c', { parameters: { junk: true } })]);
  render(<SchedulesTab {...props(api)} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.update).toHaveBeenCalledWith('c', expect.objectContaining({ parameters: { ranges: [expect.objectContaining({ weekStart: 'monday' })] } })));
});

test('at the limit Add is off and says why', async () => {
  render(<SchedulesTab {...props(fakeSchedules(Array.from({ length: 20 }, (_, i) => row(`s${i}`))))} />);
  expect(await screen.findByRole('button', { name: 'Add schedule' })).toBeDisabled();
  expect(screen.getByText(/You have 20 schedules, the most OWOX allows\./)).toBeInTheDocument();
});

test('adding a schedule creates a warm-cache schedule', async () => {
  const api = fakeSchedules();
  render(<SchedulesTab {...props(api)} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
  fireEvent.click(screen.getByRole('button', { name: 'Every 6 hours' }));
  fireEvent.click(screen.getByLabelText('This year to date'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.create).toHaveBeenCalled());
  const arg = (api.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
  expect(arg).toMatchObject({ action: 'warm-cache', cron: '0 */6 * * *' });
  expect(arg.parameters).not.toHaveProperty('memberId');
  expect(arg.parameters.ranges.map((r: { range: { preset: string } }) => r.range.preset)).toEqual(['ytd']);
});

test('without a model the form refuses to save', async () => {
  const api = fakeSchedules();
  render(<SchedulesTab {...props(api, { model: null })} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Build the model first');
  expect(api.create).not.toHaveBeenCalled();
});

test('a refusal shows its code', async () => {
  const api = fakeSchedules();
  api.create = vi.fn(async () => { throw Object.assign(new Error('Too many'), { name: 'PluginActionError', code: 'TOO_MANY_SCHEDULES' }); });
  render(<SchedulesTab {...props(api)} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('TOO_MANY_SCHEDULES');
});

test('pause, edit and delete act on the schedule', async () => {
  const api = fakeSchedules([row('a')]);
  render(<SchedulesTab {...props(api)} />);
  fireEvent.click(await screen.findByLabelText('Enabled'));
  await waitFor(() => expect(api.pause).toHaveBeenCalledWith('a'));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.click(screen.getByRole('button', { name: 'Every hour' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.update).toHaveBeenCalledWith('a', expect.objectContaining({ cron: '0 */1 * * *' })));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(api.delete).toHaveBeenCalledWith('a'));
});

test('at most five ranges can be picked', async () => {
  render(<SchedulesTab {...props(fakeSchedules())} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
  for (const l of ['This year to date', 'This quarter to date', 'This month to date', 'Last month', 'Last week']) fireEvent.click(screen.getByLabelText(l));
  expect(screen.getByLabelText('Yesterday')).toBeDisabled();
});

test('a refused resume shows its code', async () => {
  const api = fakeSchedules([row('a', { enabled: false })]);
  api.resume = vi.fn(async () => { throw Object.assign(new Error('Paused'), { name: 'PluginActionError', code: 'PAUSED_BY_ADMIN' }); });
  render(<SchedulesTab {...props(api)} />);
  fireEvent.click(await screen.findByLabelText('Enabled'));
  expect(await screen.findByRole('alert')).toHaveTextContent('PAUSED_BY_ADMIN');
});

test('a schedule with an unparsable cron keeps it on save', async () => {
  const api = fakeSchedules([row('a', { cron: '0 9 1 * 1' })]);
  render(<SchedulesTab {...props(api)} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  expect(screen.getByText('Cron: 0 9 1 * 1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.update).toHaveBeenCalledWith('a', expect.objectContaining({ cron: '0 9 1 * 1' })));
});
