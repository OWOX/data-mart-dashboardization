import { fireEvent, render, screen, within } from '@testing-library/react';
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

test('the tabs are General and Checkup, a tablist that arrow keys move through', () => {
  const onTabChange = vi.fn();
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} onTabChange={onTabChange} />);
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['General', 'Checkup']);
  const general = screen.getByRole('tab', { name: 'General' });
  const checkup = screen.getByRole('tab', { name: 'Checkup' });
  expect(general).toHaveAttribute('aria-selected', 'true');
  expect(checkup).toHaveAttribute('tabindex', '-1');
  fireEvent.keyDown(general, { key: 'ArrowRight' });
  expect(checkup).toHaveAttribute('aria-selected', 'true');
  expect(checkup).toHaveFocus();
  expect(onTabChange).toHaveBeenLastCalledWith('checkup');
  expect(screen.getByLabelText(/Red when below plan/)).not.toBeVisible();
  fireEvent.keyDown(checkup, { key: 'ArrowRight' });
  expect(general).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(general, { key: 'End' });
  expect(checkup).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(checkup, { key: 'Home' });
  expect(general).toHaveFocus();
});

test('the Checkup panel mounts only while selected', () => {
  const run = vi.fn(() => Promise.resolve([]));
  const checkup = { run, projectId: 'p', now: () => new Date() };
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} checkup={checkup} />);
  expect(run).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: 'Checkup' }));
  expect(run).toHaveBeenCalledTimes(1);
  expect(document.getElementById('gy-panel-checkup')).not.toHaveAttribute('hidden');
  fireEvent.click(screen.getByRole('tab', { name: 'General' }));
  expect(document.getElementById('gy-panel-checkup')!.childElementCount).toBe(0);
});

test('General has a Your view fieldset and a Project fieldset', () => {
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} />);
  const view = screen.getByRole('group', { name: 'Your view' });
  const project = screen.getByRole('group', { name: 'Project' });
  expect(within(view).getByLabelText('Default date range')).toBeInTheDocument();
  expect(within(view).getByLabelText('Week starts on')).toBeInTheDocument();
  expect(within(view).getByLabelText(/Compare with previous period/)).toBeInTheDocument();
  expect(within(project).getByLabelText(/Red when below plan/)).toBeEnabled();
});

test('a member sees the threshold disabled with the reason', () => {
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} isAdmin={false} />);
  const project = screen.getByRole('group', { name: 'Project' });
  expect(within(project).getByLabelText(/Red when below plan/)).toBeDisabled();
  expect(within(project).getByText('Only a project admin can change this')).toBeInTheDocument();
});

test('with no model the Metrics section says so', async () => {
  const checkup = { run: () => Promise.resolve([{ id: 'model.built', group: 'metrics' as const, label: 'The model is built', purpose: 'p', status: 'ok' as const }]), projectId: 'p', now: () => new Date() };
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} checkup={checkup} tab="checkup" noModel />);
  expect(await screen.findByText("No model yet. It's built when you go back to the canvas.")).toBeInTheDocument();
});

test('tab="checkup" opens with the panel visible and a run started', () => {
  const run = vi.fn(() => Promise.resolve([]));
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} checkup={{ run, projectId: 'p', now: () => new Date() }} tab="checkup" />);
  expect(document.getElementById('gy-panel-checkup')).not.toHaveAttribute('hidden');
  expect(run).toHaveBeenCalledTimes(1);
});

test('General does not hold the model rebuild', () => {
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

test('Settings offers None (ontology view) and it is selected when there is no default preset', () => {
  const onSave = vi.fn();
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={onSave} onBack={() => {}} />);
  const select = screen.getByLabelText('Default date range') as HTMLSelectElement;
  expect(select.options[0]!.textContent).toBe('None (ontology view)');
  expect(select.value).toBe('');
  fireEvent.change(select, { target: { value: 'mtd' } });
  fireEvent.change(select, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, defaultPreset: null });
});
