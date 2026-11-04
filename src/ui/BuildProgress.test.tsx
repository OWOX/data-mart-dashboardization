import { render, screen } from '@testing-library/react';
import { BuildProgress } from './BuildProgress';
import type { BuildStep } from '../model/build';

const steps: BuildStep[] = [
  { kind: 'read', what: 'project', done: 1, total: 1, finished: true },
  { kind: 'read', what: 'contexts', done: 2, total: 2, finished: true },
  { kind: 'read', what: 'marts', done: 3, total: 12, finished: false },
];

test('shows the reading rows and a determinate line', () => {
  render(<BuildProgress steps={steps} />);
  expect(screen.getByText('Project description')).toBeInTheDocument();
  expect(screen.getByText('Contexts: 2')).toBeInTheDocument();
  expect(screen.getByText('Data Marts: 3 of 12')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '12');
  expect(screen.getByText('Project description').querySelector('.gy-build-tick')).toHaveTextContent('✓');
  expect(screen.getByText('Data Marts: 3 of 12').querySelector('.gy-build-tick')).toBeEmptyDOMElement();
  expect(screen.queryByText(/^Goal:/)).toBeNull();
});

test('the line is indeterminate before the marts total is known', () => {
  render(<BuildProgress steps={[{ kind: 'read', what: 'project', done: 0, total: null, finished: false }]} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('data-determinate', 'false');
});

test('found rows list the goal, the first three classes and the metric count', () => {
  render(<BuildProgress steps={[...steps, { kind: 'found', goal: 'ARR (Subscriptions)', classes: ['A', 'B', 'C', 'D'], metrics: 7 }]} />);
  expect(screen.getByText('Goal: ARR (Subscriptions)')).toBeInTheDocument();
  expect(screen.getByText('Classes: 4 (A, B, C, …)')).toBeInTheDocument();
  expect(screen.getByText('Metrics: 7')).toBeInTheDocument();
});

test('a goal-only found step shows no classes or metrics rows', () => {
  render(<BuildProgress steps={[...steps, { kind: 'found', goal: 'ARR (Subscriptions)', classes: [], metrics: 0 }]} />);
  expect(screen.getByText('Goal: ARR (Subscriptions)')).toBeInTheDocument();
  expect(screen.queryByText(/^Classes:/)).toBeNull();
  expect(screen.queryByText(/^Metrics:/)).toBeNull();
});

test('the line is indeterminate while the AI reads, and the row flips when it finishes', () => {
  const m: BuildStep = { kind: 'read', what: 'marts', done: 12, total: 12, finished: true };
  const { rerender } = render(<BuildProgress steps={[m, { kind: 'read', what: 'ai', done: 0, total: null, finished: false }]} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('data-determinate', 'false');
  rerender(<BuildProgress steps={[m, { kind: 'read', what: 'ai', done: 1, total: 1, finished: true }]} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('data-determinate', 'true');
  expect(screen.getByText('AI read the descriptions')).toBeInTheDocument();
});

test('finished rows say done to screen readers; unreadable contexts show no tick', () => {
  render(<BuildProgress steps={[
    { kind: 'read', what: 'project', done: 1, total: 1, finished: true },
    { kind: 'read', what: 'contexts', done: 0, total: null, finished: false, failed: true },
  ]} />);
  expect(screen.getByText(', done')).toBeInTheDocument();
  const row = screen.getByText("Contexts: couldn't be read");
  expect(row.querySelector('.gy-build-tick')).toBeEmptyDOMElement();
});
