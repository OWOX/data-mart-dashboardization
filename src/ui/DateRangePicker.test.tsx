import { fireEvent, render, screen, within } from '@testing-library/react';
import { DateRangePicker } from './DateRangePicker';
import type { CompareChoice, RangeChoice } from '../types';

const now = new Date('2026-11-03T12:00:00Z'); // yesterday = 2026-11-02
const Q: RangeChoice = { kind: 'preset', preset: 'this_quarter' };
const PREV: CompareChoice = { kind: 'preset', preset: 'previous_period' };
const OFF: CompareChoice = { kind: 'off' };

function setup(range: RangeChoice = Q, compare: CompareChoice = PREV) {
  const onChange = vi.fn();
  render(<DateRangePicker range={range} compare={compare} now={now} onChange={onChange} />);
  return onChange;
}
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Date range' }));
const day = (cal: string, name: string) => within(screen.getByRole('group', { name: cal })).getByRole('button', { name });

test('trigger label reflects compare', () => {
  setup();
  expect(screen.getByRole('button', { name: 'Date range' })).toHaveTextContent('This quarter vs previous');
});

test('trigger label without compare', () => {
  setup(Q, OFF);
  expect(screen.getByRole('button', { name: 'Date range' })).toHaveTextContent(/^This quarter$/);
});

test('open shows presets and one calendar; compare toggles the second', () => {
  setup(Q, OFF);
  open();
  expect(screen.getByRole('dialog', { name: 'Date range' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Last month' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'This quarter' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByRole('group')).toHaveLength(1);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Compare' }));
  expect(screen.getAllByRole('group')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Same period last year' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Compare' }));
  expect(screen.getAllByRole('group')).toHaveLength(1);
});

test('preset then Apply', () => {
  const onChange = setup();
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onChange).toHaveBeenCalledWith({ kind: 'preset', preset: 'last_month' }, PREV);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('two clicks make a custom range, reversed clicks are swapped', () => {
  const onChange = setup(Q, OFF);
  open();
  fireEvent.click(day('Range calendar', 'Wednesday, November 25, 2026'));
  fireEvent.click(day('Range calendar', 'Monday, November 9, 2026'));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onChange).toHaveBeenCalledWith({ kind: 'custom', window: { from: '2026-11-09', to: '2026-11-25' } }, OFF);
});

test('comparison preset and custom comparison', () => {
  const onChange = setup();
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Same period last year' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onChange).toHaveBeenLastCalledWith(Q, { kind: 'preset', preset: 'year_before' });

  open();
  fireEvent.click(screen.getByRole('button', { name: 'Custom', pressed: false }));
  // Seeded with the previous quarter (props still say previous_period); reversed clicks swap.
  const cal = within(screen.getByRole('group', { name: 'Comparison calendar' }));
  expect(cal.getByText('August 2026')).toBeInTheDocument();
  fireEvent.click(cal.getByRole('button', { name: 'Monday, August 31, 2026' }));
  fireEvent.click(cal.getByRole('button', { name: 'Monday, August 3, 2026' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onChange).toHaveBeenLastCalledWith(Q, { kind: 'custom', window: { from: '2026-08-03', to: '2026-08-31' } });
});

test('comparison calendar follows the range and shows the resolved window', () => {
  setup(Q, PREV);
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Last year' }));
  const cal = within(screen.getByRole('group', { name: 'Comparison calendar' }));
  expect(cal.getByText(/2024$/)).toBeInTheDocument(); // year before last year
  const lit = cal.getAllByRole('button', { pressed: true });
  expect(lit.length).toBeGreaterThan(0);
  lit.forEach((b) => expect(b.getAttribute('aria-label')).toMatch(/, 2024$/));
});

test('custom comparison longer than the range is shown cut to the matched length', () => {
  const onChange = setup(Q, OFF);
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Yesterday' })); // one day
  fireEvent.click(screen.getByRole('checkbox', { name: 'Compare' }));
  fireEvent.click(screen.getByRole('button', { name: 'Custom', pressed: false }));
  const cal = within(screen.getByRole('group', { name: 'Comparison calendar' }));
  fireEvent.click(cal.getByRole('button', { name: 'Sunday, November 1, 2026' }));
  fireEvent.click(cal.getByRole('button', { name: 'Monday, November 2, 2026' }));
  expect(screen.getByRole('dialog').querySelector('.gy-drp-windows')).toHaveTextContent('Nov 2, 2026 vs Nov 1, 2026');
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onChange.mock.calls[0]![1]).toEqual({ kind: 'custom', window: { from: '2026-11-01', to: '2026-11-02' } });
});

test('outside click closes without applying', () => {
  const onChange = setup();
  open();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});

test('Cancel and Escape do not apply', () => {
  const onChange = setup();
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  open();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Date range' })).toHaveFocus();
});

test('comparison days after yesterday are disabled', () => {
  setup(Q, PREV);
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Custom', pressed: false }));
  const cal = screen.getByRole('group', { name: 'Comparison calendar' });
  for (let i = 0; i < 6 && !within(cal).queryByText('November 2026'); i++) {
    fireEvent.click(within(cal).getByRole('button', { name: 'Next month' }));
  }
  expect(within(cal).getByRole('button', { name: 'Tuesday, November 3, 2026' })).toBeDisabled();
  expect(within(cal).getByRole('button', { name: 'Monday, November 2, 2026' })).toBeEnabled();
});

test('Compare and the comparison presets live in the left column, under the range presets', () => {
  const { container } = render(<DateRangePicker range={Q} compare={OFF} now={now} onChange={() => {}} />);
  open();
  const left = container.querySelector('.gy-drp-left')!;
  expect(within(left as HTMLElement).queryByRole('button', { name: 'Previous period' })).toBeNull();
  fireEvent.click(within(left as HTMLElement).getByRole('checkbox', { name: 'Compare' }));
  const lists = left.querySelectorAll('.gy-drp-presets');
  expect(lists).toHaveLength(2);
  expect(left.children[1]!.querySelector('input[type=checkbox]')).not.toBeNull();
  expect(within(lists[0] as HTMLElement).getByRole('button', { name: 'Last month' })).toBeInTheDocument();
  expect(within(lists[1] as HTMLElement).getByRole('button', { name: 'Previous period' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(lists[1] as HTMLElement).getByRole('button', { name: 'Custom' })).toBeInTheDocument();
  expect(container.querySelector('.gy-drp-right')!.querySelectorAll('[role=group]')).toHaveLength(2);
});

test('a Sunday week start shows Su first in both calendars', () => {
  render(<DateRangePicker range={Q} compare={PREV} now={now} weekStart="sunday" onChange={() => {}} />);
  open();
  for (const name of ['Range calendar', 'Comparison calendar']) {
    const cal = screen.getByRole('group', { name });
    expect(cal.querySelector('.gy-cal-dow')!.textContent).toBe('Su');
  }
});

test('a preset stays relative: Apply passes the preset while the calendar shows its days', () => {
  const onChange = setup(Q, OFF);
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
  const cal = within(screen.getByRole('group', { name: 'Range calendar' }));
  expect(cal.getByRole('button', { name: 'Thursday, October 1, 2026' }).className).toMatch(/is-end/);
  expect(cal.getByRole('button', { name: 'Saturday, October 31, 2026' }).className).toMatch(/is-end/);
  expect(cal.getByRole('button', { name: 'Monday, October 12, 2026' }).className).toMatch(/is-mid/);
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onChange).toHaveBeenCalledWith({ kind: 'preset', preset: 'last_month' }, OFF);
});

test('the separator shows only with Compare on', () => {
  setup(Q, OFF);
  open();
  expect(screen.queryByRole('separator')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Compare' }));
  expect(screen.getByRole('separator')).toBeInTheDocument();
});
