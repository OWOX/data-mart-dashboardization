import { render, screen } from '@testing-library/react';
import { Card } from './Card';
import type { CardCache, ClassNode, MetricDef, MetricResult } from '../types';

const cls: ClassNode = { id: 'c', martId: 'c', title: 'Customers', contexts: [], depth: 0, keyMetricId: 'arr', metricIds: ['arr', 'uc'] };
const arr: MetricDef = { id: 'arr', martId: 'c', alias: 'ARR', measure: { field: 'arr', fn: 'SUM' }, kind: 'level', dateField: 'date', role: 'critical', source: 'project', isUniqueCount: false, plan: null };
const uc: MetricDef = { id: 'uc', martId: 'c', alias: 'Customers', measure: { field: 'id', fn: 'COUNT_DISTINCT' }, kind: 'flow', dateField: 'date', role: 'unique', source: 'schema', isUniqueCount: true, plan: null };
const res = (over: Partial<MetricResult>): MetricResult => ({ fact: 1_240_000, comparison: 1_000_000, diffPct: 24, plan: 1_300_000, forecast: null, forecastApprox: false, status: 'near', trend: 'up', note: null, error: null, ...over });
const cache = (over: Partial<MetricResult> = {}): CardCache => ({
  metrics: { arr: res(over), uc: res({ fact: 7148, status: 'above', trend: 'down', plan: null }) },
  spark: { start: '2026-10-01', values: [1, 2, null, 4], forecastStart: null, forecast: [] },
});

test('key metric, label, diff, badge order and status', () => {
  const { container } = render(<Card cls={cls} metrics={[arr, uc]} cache={cache()} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('1.24M')).toBeInTheDocument();
  expect(screen.getByText('ARR from Customers')).toBeInTheDocument();
  expect(screen.getByText('+24.0%')).toBeInTheDocument();
  const badge = container.querySelector('.gy-badge')!;
  expect(badge.textContent).toMatch(/^7\.15K Customers/);
  expect(badge.getAttribute('data-status')).toBe('above');
  expect(screen.getByLabelText('trend down')).toBeInTheDocument();
  expect(container.querySelector('.gy-card')!.getAttribute('data-status')).toBe('near');
  expect(container.textContent).not.toMatch(/unique count/i);
});

test('no diff when comparison is off; forecast shown when fact is missing', () => {
  render(<Card cls={cls} metrics={[arr, uc]} cache={cache({ fact: null, forecast: 900, forecastApprox: true })} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  expect(screen.queryByText('+24.0%')).toBeNull();
  expect(screen.getByText('Forecast ≈900')).toBeInTheDocument();
});

test('an exact forecast without a fact has no approximation sign', () => {
  render(<Card cls={cls} metrics={[arr, uc]} cache={cache({ fact: null, forecast: 900, forecastApprox: false })} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('Forecast 900')).toBeInTheDocument();
});

test('error card offers retry; empty card says no metric', () => {
  const onRetry = vi.fn();
  render(<Card cls={cls} metrics={[arr, uc]} cache={cache({ error: 'TIMEOUT' })} comparisonOn refreshing={false} onRetry={onRetry} />);
  screen.getByRole('button', { name: 'Retry' }).click();
  expect(onRetry).toHaveBeenCalled();
  render(<Card cls={{ ...cls, keyMetricId: null, metricIds: [] }} metrics={[]} cache={undefined} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('No metric yet')).toBeInTheDocument();
});
