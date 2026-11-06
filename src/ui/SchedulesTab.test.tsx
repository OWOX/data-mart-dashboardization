import type { PluginSchedule, PluginSchedules } from '@owox/plugin-sdk';
import { render, screen, fireEvent, waitFor, within } from '../test-host';
import { SchedulesTab } from './SchedulesTab';
import { memoryCollections } from '../store/collections';
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
const row = (id: string, memberId: unknown, extra: Partial<PluginSchedule> = {}): PluginSchedule => ({
  id, name: null, action: 'warm-cache', parameters: { memberId, martIds: ['m1'], ranges: [range] }, cron: '0 9 * * 1,2,3,4,5', timeZone: 'UTC',
  enabled: true, disabledReason: null, nextRunAt: null, lastRun: null, createdAt: '', modifiedAt: '', ...extra,
});
const props = (schedules: PluginSchedules | undefined, extra = {}) => ({ schedules, memberId: 'u1', model: fixtureModel, settings: DEFAULT_SETTINGS, store: memoryCollections(), ...extra });

test('without ctx.schedules the tab says OWOX is too old', () => {
  render(<SchedulesTab {...props(undefined)} />);
  expect(screen.getByText(/need a newer version/)).toBeInTheDocument();
});

test('lists only own, well-formed schedules, and counts all of them', async () => {
  render(<SchedulesTab {...props(fakeSchedules([row('a', 'u1'), row('b', 'u2'), { ...row('c', 'u1'), parameters: { junk: true } }]))} />);
  expect(await screen.findByText('3 of 20 schedules used in this project')).toBeInTheDocument();
  expect(screen.getAllByText('Mon, Tue, Wed, Thu, Fri at 09:00')).toHaveLength(1);
});

test('adding a schedule writes the snapshot and creates a warm-cache schedule', async () => {
  const api = fakeSchedules();
  const p = props(api);
  render(<SchedulesTab {...p} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
  fireEvent.click(screen.getByRole('button', { name: 'Every 6 hours' }));
  fireEvent.click(screen.getByLabelText('This year to date'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.create).toHaveBeenCalled());
  const arg = (api.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
  expect(arg).toMatchObject({ action: 'warm-cache', cron: '0 */6 * * *' });
  expect(arg.parameters.memberId).toBe('u1');
  expect(arg.parameters.ranges.map((r: { range: { preset: string } }) => r.range.preset)).toEqual(['ytd']);
  expect(await p.store.collections('schedule-models').get(`u1:${arg.parameters.martIds[0]}`)).not.toBeNull();
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
  const api = fakeSchedules([row('a', 'u1')]);
  window.confirm = vi.fn(() => true);
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
