import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';
import { DEFAULT_SETTINGS } from '../types';

test('saves edited threshold', () => {
  const onSave = vi.fn();
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={onSave} onBack={() => {}} />);
  fireEvent.change(screen.getByLabelText(/Red when below plan/), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, thresholdPct: 15 });
});

test('saves the chosen week start', () => {
  const onSave = vi.fn();
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={onSave} onBack={() => {}} />);
  const select = screen.getByLabelText('Week starts on') as HTMLSelectElement;
  expect(select.value).toBe('monday');
  fireEvent.change(select, { target: { value: 'sunday' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, weekStart: 'sunday' });
});

test('the tabs are a tablist that arrow keys move through', () => {
  const onTabChange = vi.fn();
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} onTabChange={onTabChange} />);
  expect(screen.getByRole('tablist')).toBeInTheDocument();
  const general = screen.getByRole('tab', { name: 'General' });
  const onto = screen.getByRole('tab', { name: 'Metrics' });
  expect(general).toHaveAttribute('aria-selected', 'true');
  expect(onto).toHaveAttribute('tabindex', '-1');
  fireEvent.keyDown(general, { key: 'ArrowRight' });
  expect(onto).toHaveAttribute('aria-selected', 'true');
  expect(onto).toHaveFocus();
  expect(onTabChange).toHaveBeenLastCalledWith('ontology');
  expect(screen.getByLabelText(/Red when below plan/)).not.toBeVisible();
  const checkup = screen.getByRole('tab', { name: 'Checkup' });
  fireEvent.keyDown(onto, { key: 'ArrowRight' });
  expect(checkup).toHaveAttribute('aria-selected', 'true');
  const schedulesTab = screen.getByRole('tab', { name: 'Schedules' });
  fireEvent.keyDown(checkup, { key: 'ArrowRight' });
  expect(schedulesTab).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(schedulesTab, { key: 'ArrowRight' });
  expect(general).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(general, { key: 'End' });
  expect(schedulesTab).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(schedulesTab, { key: 'Home' });
  expect(general).toHaveFocus();
});

test('the Checkup tab follows Metrics and mounts its panel only while selected', () => {
  const run = vi.fn(() => Promise.resolve([]));
  const checkup = { run, projectId: 'p', now: () => new Date() };
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} checkup={checkup} />);
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['General', 'Metrics', 'Checkup', 'Schedules']);
  expect(run).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: 'Checkup' }));
  expect(run).toHaveBeenCalledTimes(1);
  expect(document.getElementById('gy-panel-checkup')).not.toHaveAttribute('hidden');
  fireEvent.click(screen.getByRole('tab', { name: 'General' }));
  expect(document.getElementById('gy-panel-checkup')!.childElementCount).toBe(0);
});

test('tab="checkup" opens with the panel visible and a run started', () => {
  const run = vi.fn(() => Promise.resolve([]));
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} checkup={{ run, projectId: 'p', now: () => new Date() }} tab="checkup" />);
  expect(document.getElementById('gy-panel-checkup')).not.toHaveAttribute('hidden');
  expect(run).toHaveBeenCalledTimes(1);
});

test('General no longer holds the model rebuild; the Ontology tab does', () => {
  const onRebuild = vi.fn();
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} onRebuild={onRebuild} tab="general" />);
  expect(screen.queryByRole('button', { name: 'Rebuild model' })).toBeNull();
});

test('every tab points at an existing panel', () => {
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} />);
  for (const t of screen.getAllByRole('tab')) expect(document.getElementById(t.getAttribute('aria-controls')!)).not.toBeNull();
});

test('the default date range says it applies only to the member', () => {
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} />);
  expect(screen.getByLabelText('Default date range').closest('.gy-field')?.textContent).toContain('Only for you');
});

test('the Schedules tab follows Checkup and renders the schedules tab', () => {
  const schedules = { schedules: undefined, model: null, settings: DEFAULT_SETTINGS };
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} schedules={schedules} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Schedules' }));
  expect(screen.getByText(/need a newer version/)).toBeInTheDocument();
});
