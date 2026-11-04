import { render } from '@testing-library/react';
import { Calendar } from './Calendar';

const grid = (weekStart?: 'monday' | 'sunday') => {
  const { container } = render(<Calendar month="2026-11-01" selected={null} weekStart={weekStart} aria-label="c" onPick={() => {}} onMonth={() => {}} />);
  return {
    dows: [...container.querySelectorAll('.gy-cal-dow')].map((e) => e.textContent),
    first: container.querySelector('.gy-cal-day')!.getAttribute('aria-label'),
    count: container.querySelectorAll('.gy-cal-day').length,
  };
};

test('Monday start by default: the November 2026 grid begins on Monday Oct 26', () => {
  const g = grid();
  expect(g.dows).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
  expect(g.first).toBe('Monday, October 26, 2026');
});

test('Sunday start: Su first and the grid begins on Sunday Nov 1', () => {
  const g = grid('sunday');
  expect(g.dows).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
  expect(g.first).toBe('Sunday, November 1, 2026');
  expect(g.count % 7).toBe(0);
});
