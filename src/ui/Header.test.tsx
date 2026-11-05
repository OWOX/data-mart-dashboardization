import { fireEvent, render, screen } from '@testing-library/react';
import { Header, RangeControls } from './Header';

const controls = (over: Partial<Parameters<typeof RangeControls>[0]> = {}) => (
  <RangeControls range={{ kind: 'preset', preset: 'cur_quarter' }} compare={{ kind: 'preset', preset: 'previous_period' }} now={new Date('2026-10-24T10:00:00Z')} onChange={() => {}} onRefresh={() => {}} onSettings={() => {}} {...over} />
);

test('the header reads Gyroscope with the update time, no controls and no label', () => {
  render(<Header cache={null} now={new Date()} />);
  expect(screen.getByRole('heading', { name: 'Gyroscope' })).toBeInTheDocument();
  expect(screen.getByText('Not loaded yet')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByText('GYROSCOPE')).toBeNull();
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
  const { container, rerender } = render(<Header cache={cache} now={now} period={period} />);
  const line = container.querySelector('.gy-header-line')!;
  expect(line.firstElementChild).toBe(screen.getByRole('heading', { name: 'Gyroscope' }));
  expect(line.querySelector('.gy-header-sub')!.textContent).toBe('Oct 1 – Nov 2 vs Jul 1 – Aug 2, 2026 · Updated 12 min ago');
  rerender(<Header cache={null} now={now} period={{ ...period, comparison: null }} />);
  expect(line.querySelector('.gy-header-sub')!.textContent).toBe('Oct 1 – Nov 2, 2026 · Not loaded yet');
});

test('the loading step replaces the update time after the period', () => {
  const win = (from: string, to: string) => ({ from, to });
  const period = { range: win('2026-10-01', '2026-11-01'), comparison: win('2026-07-01', '2026-08-01') };
  const cache = { refreshedAt: '2026-10-24T09:00:00Z' } as never;
  const { rerender } = render(<Header cache={cache} now={new Date('2026-10-24T10:00:00Z')} period={period} status="Loading metrics 12 of 31" />);
  const sub = document.querySelector('.gy-header-sub')!;
  expect(sub).toHaveAttribute('aria-live', 'polite');
  expect(sub.textContent).toMatch(/ · Loading metrics 12 of 31$/);
  expect(sub.textContent).not.toMatch(/Updated/);
  rerender(<Header cache={cache} now={new Date('2026-10-24T10:00:00Z')} period={period} status={null} />);
  expect(sub.textContent).toMatch(/ · Updated 1 h ago$/);
});

describe('issues icon', () => {
  const issue = { classTitle: 'Customers', metricName: 'ARR', text: 'The field "arr" no longer exists.' };
  const withNotices = (over: Partial<NonNullable<Parameters<typeof Header>[0]['notices']>> = {}) => (
    <Header cache={null} now={new Date()} notices={{ issues: [issue], outdated: false, onReview: () => {}, ...over }} />
  );

  test('no icon without notices', () => {
    render(<Header cache={null} now={new Date()} notices={{ issues: [], outdated: false, onReview: () => {} }} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('the name carries the count', () => {
    const { rerender } = render(withNotices());
    expect(screen.getByRole('button', { name: '1 issue' })).toHaveAttribute('aria-haspopup', 'dialog');
    rerender(withNotices({ issues: [issue, issue], outdated: true }));
    expect(screen.getByRole('button', { name: '3 issues' })).toBeInTheDocument();
  });

  test('clicking opens the dialog with each issue', () => {
    render(withNotices());
    const icon = screen.getByRole('button', { name: '1 issue' });
    expect(icon).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(icon);
    const dialog = screen.getByRole('dialog', { name: 'Issues' });
    expect(dialog).toHaveFocus();
    expect(icon).toHaveAttribute('aria-expanded', 'true');
    expect(dialog).toHaveTextContent('Broken references');
    expect(dialog).toHaveTextContent('Customers · ARR');
    expect(dialog).toHaveTextContent('The field "arr" no longer exists.');
    expect(dialog).not.toHaveTextContent('Model out of date');
  });

  test('Escape closes it and focus returns to the icon; so does an outside pointerdown', () => {
    render(withNotices());
    const icon = screen.getByRole('button', { name: '1 issue' });
    fireEvent.click(icon);
    screen.getByRole('button', { name: 'Review in Metrics' }).focus();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(icon).toHaveFocus();
    fireEvent.click(icon);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(icon).toHaveFocus();
  });

  test('the out-of-date group shows only when the notice would', () => {
    const { rerender } = render(withNotices({ outdated: true }));
    fireEvent.click(screen.getByRole('button', { name: '2 issues' }));
    expect(screen.getByText('The descriptions changed since this model was built.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rebuild to see proposed changes' })).toBeInTheDocument();
    rerender(withNotices({ outdated: false }));
    expect(screen.queryByText('The descriptions changed since this model was built.')).toBeNull();
  });

  test('the footer link and the rebuild button open the Ontology tab', () => {
    const onReview = vi.fn();
    render(withNotices({ outdated: true, onReview }));
    fireEvent.click(screen.getByRole('button', { name: '2 issues' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review in Metrics' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild to see proposed changes' }));
    expect(onReview).toHaveBeenCalledTimes(2);
  });
});
