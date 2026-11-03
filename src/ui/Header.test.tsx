import { fireEvent, render, screen } from '@testing-library/react';
import { Header, RangeControls } from './Header';

const controls = (over: Partial<Parameters<typeof RangeControls>[0]> = {}) => (
  <RangeControls preset="this_quarter" comparisonOn onPreset={() => {}} onComparison={() => {}} onRefresh={() => {}} onSettings={() => {}} {...over} />
);

test('the header holds the title and the update time, no controls', () => {
  render(<Header title="Customers" cache={null} now={new Date()} />);
  expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument();
  expect(screen.getByText('Not loaded yet')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
});

test('refresh and settings icons follow the date range, settings last', () => {
  const onRefresh = vi.fn();
  const onSettings = vi.fn();
  const { container } = render(controls({ onRefresh, onSettings }));
  const row = container.querySelector('.gy-range')!;
  expect([...row.children].map((c) => c.getAttribute('aria-label') ?? c.tagName)).toEqual(['LABEL', 'Date range', 'Refresh', 'Settings']);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(onSettings).toHaveBeenCalledTimes(1);
});

test('refresh is disabled while refreshing', () => {
  render(controls({ refreshing: true }));
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
});

test('range controls change the preset and the comparison', () => {
  const onPreset = vi.fn();
  const onComparison = vi.fn();
  render(controls({ onPreset, onComparison }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Date range' }), { target: { value: 'last_month' } });
  fireEvent.click(screen.getByLabelText('Compare with previous period'));
  expect(onPreset).toHaveBeenCalledWith('last_month');
  expect(onComparison).toHaveBeenCalledWith(false);
});
