import { fireEvent, render, screen, within } from '@testing-library/react';
import { DateRangePicker } from './DateRangePicker';
import type { CompareChoice, RangeChoice } from '../types';

const now = new Date('2026-11-03T12:00:00Z'); // yesterday = 2026-11-02
const Q: RangeChoice = { kind: 'preset', preset: 'cur_quarter' };
/** Quarter to date: its previous period is the same days of the last quarter, which the calendar test below leans on. */
const QTD: RangeChoice = { kind: 'preset', preset: 'qtd' };
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
  const onChange = setup(QTD);
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Same period last year' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onChange).toHaveBeenLastCalledWith(QTD, { kind: 'preset', preset: 'year_before' });

  open();
  fireEvent.click(screen.getByRole('button', { name: 'Custom', pressed: false }));
  // Seeded with the previous quarter (props still say previous_period); reversed clicks swap.
  const cal = within(screen.getByRole('group', { name: 'Comparison calendar' }));
  expect(cal.getByText('August 2026')).toBeInTheDocument();
  fireEvent.click(cal.getByRole('button', { name: 'Monday, August 31, 2026' }));
  fireEvent.click(cal.getByRole('button', { name: 'Monday, August 3, 2026' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onChange).toHaveBeenLastCalledWith(QTD, { kind: 'custom', window: { from: '2026-08-03', to: '2026-08-31' } });
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
  expect(screen.getByRole('dialog').querySelector('.gy-drp-windows')).toHaveTextContent('Nov 2 vs Nov 1, 2026');
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

describe('presets, comparison windows and the forecast footnote (today = Nov 5)', () => {
  const today = new Date('2026-11-05T12:00:00Z');
  const mount = (range: RangeChoice, compare: CompareChoice = PREV) => { render(<DateRangePicker range={range} compare={compare} now={today} onChange={() => {}} />); open(); };

  test('the list runs Current, To date, Past, then Custom', () => {
    mount({ kind: 'preset', preset: 'cur_month' }, OFF);
    const list = screen.getByRole('dialog').querySelector('.gy-drp-list')!;
    expect([...list.children].map((c) => c.textContent)).toEqual([
      'This year', 'This quarter', 'This month', 'This week',
      'This year to date', 'This quarter to date', 'This month to date', 'This week to date',
      'Last year', 'Last quarter', 'Last month', 'Last week', 'Last 28 days', 'Last 7 days', 'Yesterday', 'Custom',
    ]);
  });

  test('each comparison option shows its window in grey', () => {
    mount({ kind: 'preset', preset: 'cur_month' });
    const wins = (name: string) => screen.getByRole('button', { name }).querySelector('.gy-drp-win')!.textContent;
    expect(wins('Previous period')).toBe('Oct 1–31');
    expect(wins('Same period last year')).toBe('Nov 1–30, 2025');
  });

  test('a past range names the preceding days', () => {
    mount({ kind: 'preset', preset: 'last_month' });
    expect(screen.getByRole('button', { name: 'Previous 31 days' }).querySelector('.gy-drp-win')!.textContent).toBe('Aug 31 – Sep 30');
  });

  test('a projected range names the preceding days by its own window', () => {
    mount({ kind: 'preset', preset: 'cur_month' });
    const b = screen.getByRole('button', { name: 'Previous 30 days' });
    expect(b.querySelector('.gy-drp-win')!.textContent).toBe('Oct 2–31');
  });

  test('a projected range gets a footnote with the forecast tooltip', () => {
    mount({ kind: 'preset', preset: 'cur_month' });
    const head = screen.getByRole('dialog').querySelector('.gy-drp-windows')!;
    expect(head.querySelector('sup')).toHaveTextContent('*');
    expect(head).toHaveTextContent('Nov 1–30* vs Oct 1–31, 2026');
    expect(head.querySelector('.gy-drp-note')).toHaveTextContent('* Nov 5–30 forecast');
    expect(screen.getByRole('tooltip')).toHaveTextContent("Nov 5–30 hasn't happened yet. Each card fills these days with its metric's forecast: from the forecast Data Mart set in the Ontology, or else from the trend and weekday pattern of the last 90 days.");
  });

  test('a to-date range has no footnote', () => {
    mount({ kind: 'preset', preset: 'mtd' });
    expect(screen.getByRole('dialog').querySelector('sup')).toBeNull();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  test('a custom comparison of a projected quarter opens on the month where the whole previous quarter ends', () => {
    mount({ kind: 'preset', preset: 'cur_quarter' });
    fireEvent.click(screen.getByRole('button', { name: 'Custom', pressed: false }));
    expect(within(screen.getByRole('group', { name: 'Comparison calendar' })).getByText('September 2026')).toBeInTheDocument();
  });
});
