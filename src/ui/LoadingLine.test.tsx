import { render, screen } from '@testing-library/react';
import { LoadingLine } from './LoadingLine';

test('determinate when the total is known', () => {
  const { container } = render(<LoadingLine progress={{ done: 3, total: 12 }} />);
  const bar = screen.getByRole('progressbar', { name: 'Loading data' });
  expect(bar).toHaveAttribute('aria-valuemin', '0');
  expect(bar).toHaveAttribute('aria-valuemax', '12');
  expect(bar).toHaveAttribute('aria-valuenow', '3');
  expect(container.querySelector('span')).toHaveStyle({ width: '25%' });
});

test('indeterminate without a total', () => {
  const { container } = render(<LoadingLine />);
  const bar = screen.getByRole('progressbar', { name: 'Loading data' });
  expect(bar).not.toHaveAttribute('aria-valuenow');
  expect(bar).toHaveAttribute('data-determinate', 'false');
  expect(container.querySelector('span')).toBeNull();
});
