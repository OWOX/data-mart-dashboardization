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

test('rebuild model lives on the settings page', () => {
  const onRebuild = vi.fn();
  const { rerender } = render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} onRebuild={onRebuild} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild model' }));
  expect(onRebuild).toHaveBeenCalledTimes(1);
  rerender(<SettingsPage settings={DEFAULT_SETTINGS} onSave={() => {}} onBack={() => {}} onRebuild={onRebuild} canRebuild={false} />);
  expect(screen.getByRole('button', { name: 'Rebuild model' })).toBeDisabled();
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
