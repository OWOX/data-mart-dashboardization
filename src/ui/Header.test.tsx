import { fireEvent, render, screen } from '@testing-library/react';
import { Header, RangeControls } from './Header';

test('refresh and settings are icon buttons, refresh first, settings last', () => {
  const onRefresh = vi.fn();
  const onSettings = vi.fn();
  const { container } = render(<Header title="Customers" cache={null} now={new Date()} onRefresh={onRefresh} onRebuild={() => {}} onSettings={onSettings} />);
  const icons = [...container.querySelectorAll('.gy-header-tools .gy-icon-btn')];
  expect(icons.map((b) => b.getAttribute('aria-label'))).toEqual(['Refresh', 'Settings']);
  expect(container.querySelector('.gy-header-tools')!.lastElementChild).toBe(icons[1]);
  expect(screen.queryByRole('combobox', { name: 'Date range' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(onSettings).toHaveBeenCalledTimes(1);
});

test('refresh is disabled while refreshing', () => {
  render(<Header title="Customers" cache={null} now={new Date()} refreshing onRefresh={() => {}} onRebuild={() => {}} onSettings={() => {}} />);
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
});

test('range controls change the preset and the comparison', () => {
  const onPreset = vi.fn();
  const onComparison = vi.fn();
  render(<RangeControls preset="this_quarter" comparisonOn onPreset={onPreset} onComparison={onComparison} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Date range' }), { target: { value: 'last_month' } });
  fireEvent.click(screen.getByLabelText('Compare with previous period'));
  expect(onPreset).toHaveBeenCalledWith('last_month');
  expect(onComparison).toHaveBeenCalledWith(false);
});
