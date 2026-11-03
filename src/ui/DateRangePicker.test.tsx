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
  expect(screen.getByRole('button', { name: /same period last year/i })).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole('button', { name: /same period last year/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onChange).toHaveBeenLastCalledWith(Q, { kind: 'preset', preset: 'year_before' });

  open();
  fireEvent.click(screen.getByRole('button', { name: 'Custom', pressed: false }));
  const cal = 'Comparison calendar';
  const first = within(screen.getByRole('group', { name: cal })).getAllByRole('button', { name: /^\w+day, / }).filter((b) => !b.classList.contains('is-out'));
  fireEvent.click(first[4]!);
  fireEvent.click(first[1]!);
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  const [, cmp] = onChange.mock.calls.at(-1)!;
  expect(cmp.kind).toBe('custom');
  expect(cmp.window.from < cmp.window.to).toBe(true);
});

test('Cancel and Escape do not apply', () => {
  const onChange = setup();
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  open();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Date range' })).toHaveFocus();
});

test('comparison days after yesterday are disabled', () => {
  setup(Q, PREV);
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Last year' }));
  fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Custom', pressed: false }));
  const cal = screen.getByRole('group', { name: 'Comparison calendar' });
  for (let i = 0; i < 6 && !within(cal).queryByText('November 2026'); i++) {
    fireEvent.click(within(cal).getByRole('button', { name: 'Next month' }));
  }
  expect(within(cal).getByRole('button', { name: 'Tuesday, November 3, 2026' })).toBeDisabled();
  expect(within(cal).getByRole('button', { name: 'Monday, November 2, 2026' })).toBeEnabled();
});
