import { fireEvent, render, screen } from '@testing-library/react';
import { Canvas } from './Canvas';
import type { Model } from '../types';

const model = {
  goal: { classId: 'm' },
  classes: [
    { id: 'm', martId: 'm', title: 'Main', depth: 0, keyMetricId: null, metricIds: [], contexts: [] },
    { id: 'a', martId: 'a', title: 'Alpha', depth: 1, keyMetricId: null, metricIds: [], contexts: [{ id: 'g', name: 'Growth' }] },
  ],
  edges: [{ from: 'm', to: 'a' }],
  metrics: [],
} as unknown as Model;

test('chips filter classes, main stays', () => {
  render(<Canvas model={model} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('Alpha')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Growth' }));
  expect(screen.getByRole('button', { name: 'Growth' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Main')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
});

const rich = {
  goal: { classId: 'm' },
  classes: [
    { id: 'm', martId: 'm', title: 'Main', depth: 0, keyMetricId: 'k', metricIds: ['k'], contexts: [] },
    { id: 'a', martId: 'a', title: 'Alpha', depth: 1, keyMetricId: null, metricIds: [], contexts: [{ id: 'g', name: 'Growth' }] },
    { id: 'b', martId: 'b', title: 'Beta', depth: 2, keyMetricId: null, metricIds: [], contexts: [{ id: 's', name: 'Sales' }] },
  ],
  edges: [{ from: 'm', to: 'a' }, { from: 'a', to: 'b' }],
  metrics: [{ id: 'k', martId: 'm', alias: 'K', measure: { field: 'f', fn: 'SUM' }, kind: 'flow', dateField: null, role: 'critical', source: 'project', isUniqueCount: false, plan: null }],
} as unknown as Model;

test('chip hides other classes; context-less class shows only under All', () => {
  render(<Canvas model={rich} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sales' }));
  expect(screen.queryByText('Alpha')).toBeNull();
  expect(screen.getByText('Beta')).toBeInTheDocument();
  expect(screen.getByText('Main')).toBeInTheDocument();
});

test('bridged connector is dashed', () => {
  const { container } = render(<Canvas model={rich} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(container.querySelectorAll('line[data-dashed="false"]')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Sales' }));
  const lines = container.querySelectorAll('line');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toHaveAttribute('data-from', 'm');
  expect(lines[0]).toHaveAttribute('data-to', 'b');
  expect(lines[0]).toHaveAttribute('data-dashed', 'true');
});

test('progress bar only while refreshing', () => {
  const { container, rerender } = render(<Canvas model={rich} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(container.querySelector('.gy-progress')).toBeNull();
  rerender(<Canvas model={rich} cache={null} comparisonOn refreshing onRetry={() => {}} />);
  expect(container.querySelector('.gy-progress')).not.toBeNull();
});

test('retry on error card calls onRetry', () => {
  const onRetry = vi.fn();
  const cache = { cards: { m: { metrics: { k: { error: 'boom' } }, spark: null } } } as never;
  render(<Canvas model={rich} cache={cache} comparisonOn refreshing={false} onRetry={onRetry} />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('stale selection is dropped when the context disappears', () => {
  const { rerender } = render(<Canvas model={rich} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sales' }));
  const without = { ...rich, classes: rich.classes.map((c) => ({ ...c, contexts: c.contexts.filter((x) => x.id !== 's') })) } as Model;
  rerender(<Canvas model={without} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Beta')).toBeInTheDocument();
});
