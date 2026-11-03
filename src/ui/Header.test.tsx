import { fireEvent, render, screen } from '@testing-library/react';
import { Header, RangeControls } from './Header';

const controls = (over: Partial<Parameters<typeof RangeControls>[0]> = {}) => (
  <RangeControls range={{ kind: 'preset', preset: 'this_quarter' }} compare={{ kind: 'preset', preset: 'previous_period' }} now={new Date('2026-10-24T10:00:00Z')} onChange={() => {}} onRefresh={() => {}} onSettings={() => {}} {...over} />
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
  expect([...row.children].map((c) => c.querySelector('[aria-label]')?.getAttribute('aria-label') ?? c.getAttribute('aria-label') ?? c.tagName)).toEqual(['Date range', 'Refresh', 'Settings']);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(onSettings).toHaveBeenCalledTimes(1);
});

test('refresh is disabled while refreshing', () => {
  render(controls({ refreshing: true }));
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
});

test('the date range is one button that shows the range and the comparison', () => {
  render(controls());
  expect(screen.getByRole('button', { name: 'Date range' })).toHaveTextContent('This quarter vs previous');
  expect(screen.queryByRole('combobox')).toBeNull();
});

test('picking in the control reports both the range and the comparison', () => {
  const onChange = vi.fn();
  render(controls({ onChange }));
  fireEvent.click(screen.getByRole('button', { name: 'Date range' }));
  fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onChange).toHaveBeenCalledWith({ kind: 'preset', preset: 'last_month' }, { kind: 'preset', preset: 'previous_period' });
});

test('the windows and the update time sit next to the title', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  const period = { range: { from: '2026-10-01', to: '2026-11-02' }, comparison: { from: '2026-07-01', to: '2026-08-02' } };
  const cache = { refreshedAt: '2026-11-03T11:48:00Z' } as never;
  const { container, rerender } = render(<Header title="Customers" cache={cache} now={now} period={period} />);
  const line = container.querySelector('.gy-header-line')!;
  expect(line.firstElementChild).toBe(screen.getByRole('heading', { name: 'Customers' }));
  expect(line.querySelector('.gy-header-sub')!.textContent).toBe('Oct 1 – Nov 2 vs Jul 1 – Aug 2, 2026 · Updated 12 min ago');
  rerender(<Header title="Customers" cache={null} now={now} period={{ ...period, comparison: null }} />);
  expect(line.querySelector('.gy-header-sub')!.textContent).toBe('Oct 1 – Nov 2, 2026 · Not loaded yet');
});
