import { render, screen } from '@testing-library/react';
import { Preloader } from './Preloader';

test('shows the step label as a polite status', () => {
  render(<Preloader label="Reading Data Marts…" />);
  const status = screen.getByRole('status');
  expect(status).toHaveAttribute('aria-live', 'polite');
  expect(status).toHaveTextContent('Reading Data Marts…');
  expect(screen.queryByRole('progressbar')).toBeNull();
});

test('shows a determinate bar with done of total', () => {
  render(<Preloader label="Loading metrics…" done={3} total={12} />);
  const bar = screen.getByRole('progressbar', { name: 'Loading data' });
  expect(bar).toHaveAttribute('aria-valuemin', '0');
  expect(bar).toHaveAttribute('aria-valuemax', '12');
  expect(bar).toHaveAttribute('aria-valuenow', '3');
  expect(screen.getByText('3 of 12')).toBeInTheDocument();
});
