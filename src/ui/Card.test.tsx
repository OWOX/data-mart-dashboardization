import { fireEvent, render, screen } from '@testing-library/react';
import { Card } from './Card';
import type { CardCache, ClassNode, MetricDef, MetricResult } from '../types';

const cls: ClassNode = { id: 'c', martId: 'c', title: 'Customers', contexts: [], depth: 0, keyMetricId: 'arr', metricIds: ['arr', 'uc'] };
const arr: MetricDef = { id: 'arr', martId: 'c', alias: 'ARR', measure: { field: 'arr', fn: 'SUM' }, kind: 'level', dateField: 'date', role: 'critical', source: 'project', isUniqueCount: false, plan: null };
const uc: MetricDef = { id: 'uc', martId: 'c', alias: 'Customers', measure: { field: 'id', fn: 'COUNT_DISTINCT' }, kind: 'flow', dateField: 'date', role: 'unique', source: 'schema', isUniqueCount: true, plan: null };
const res = (over: Partial<MetricResult>): MetricResult => ({ fact: 1_240_000, compareFact: null, comparison: 1_000_000, diffPct: 24, plan: 1_300_000, forecast: null, forecastApprox: false, status: 'near', trend: 'up', note: null, error: null, ...over });
const cache = (over: Partial<MetricResult> = {}): CardCache => ({
  metrics: { arr: res(over), uc: res({ fact: 7148, status: 'above', trend: 'down', plan: null }) },
  spark: { start: '2026-10-01', values: [1, 2, null, 4], forecastStart: null, forecast: [] },
});

test('key metric, label, diff, badge order and status', () => {
  const { container } = render(<Card cls={cls} metrics={[arr, uc]} cache={cache()} comparisonOn compareLabel="Last Month" refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('1.24M')).toBeInTheDocument();
  expect(screen.getByText('ARR')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/from Customers/);
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
  expect(screen.getByText('≈900')).toBeInTheDocument();
  expect(screen.queryByText(/^Forecast/)).toBeNull();
});

test('an exact forecast without a fact has no approximation sign', () => {
  render(<Card cls={cls} metrics={[arr, uc]} cache={cache({ fact: null, forecast: 900, forecastApprox: false })} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('900')).toBeInTheDocument();
});

test('error card offers retry; empty card says no metric', () => {
  const onRetry = vi.fn();
  render(<Card cls={cls} metrics={[arr, uc]} cache={cache({ error: 'TIMEOUT' })} comparisonOn refreshing={false} onRetry={onRetry} />);
  screen.getByRole('button', { name: 'Retry' }).click();
  expect(onRetry).toHaveBeenCalled();
  render(<Card cls={{ ...cls, keyMetricId: null, metricIds: [] }} metrics={[]} cache={undefined} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('No metric yet')).toBeInTheDocument();
});

test('header shows the mart kind glyph; the info hint carries mart and metric descriptions', () => {
  const described = { ...arr, description: 'Annual recurring revenue at period end' };
  const { container } = render(<Card cls={cls} mart={{ description: 'One row per paying customer', icon: 'customers' }} metrics={[described, uc]} cache={cache({})} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(container.querySelector('.gy-logo svg')).not.toBeNull();
  const hint = screen.getByLabelText(`About ${cls.title}`);
  expect(hint.textContent).toContain('One row per paying customer');
  expect(hint.textContent).toContain('Annual recurring revenue at period end');
});

test('no info hint when nothing is described', () => {
  render(<Card cls={cls} mart={{ description: '  ', icon: null }} metrics={[arr, uc]} cache={cache({})} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.queryByLabelText(`About ${cls.title}`)).toBeNull();
});

test('comparison row: arrow, a chip that asks to switch, then the period', () => {
  const onToggle = vi.fn();
  const { container, rerender } = render(<Card cls={cls} metrics={[arr, uc]} cache={cache()} comparisonOn compareLabel="Last Month" onToggleDiff={onToggle} refreshing={false} onRetry={() => {}} />);
  const row = container.querySelector('.gy-compare')!;
  expect(row.getAttribute('data-sign')).toBe('up');
  expect(row.querySelector('.gy-delta')!.textContent).toBe('+24.0%');
  expect(row.textContent).toContain('vs');
  expect(row.textContent).toContain('Last Month');
  fireEvent.click(screen.getByRole('button', { name: '+24.0%' }));
  expect(onToggle).toHaveBeenCalledTimes(1);
  rerender(<Card cls={cls} metrics={[arr, uc]} cache={cache()} comparisonOn compareLabel="Last Month" absolute onToggleDiff={onToggle} refreshing={false} onRetry={() => {}} />);
  expect(screen.getByRole('button', { name: '+240K' })).toBeInTheDocument();
});

test('a zero comparison can only show the absolute difference', () => {
  render(<Card cls={cls} metrics={[arr, uc]} cache={cache({ comparison: 0, diffPct: null })} comparisonOn compareLabel="Last Month" onToggleDiff={() => {}} refreshing={false} onRetry={() => {}} />);
  expect(screen.getByRole('button', { name: '+1.24M' })).toBeDisabled();
});

test('no comparison row when comparison is off; a dash when the period has no data', () => {
  const { container, rerender } = render(<Card cls={cls} metrics={[arr, uc]} cache={cache()} comparisonOn={false} compareLabel="Last Month" refreshing={false} onRetry={() => {}} />);
  expect(container.querySelector('.gy-compare')).toBeNull();
  rerender(<Card cls={cls} metrics={[arr, uc]} cache={cache({ comparison: null, diffPct: null })} comparisonOn compareLabel="Last Month" refreshing={false} onRetry={() => {}} />);
  expect(container.querySelector('.gy-delta')!.textContent).toBe('—');
});

test('a unique count names its metric Count under the class name', () => {
  const only = { ...cls, keyMetricId: 'uc', metricIds: ['uc'] };
  render(<Card cls={only} metrics={[uc]} cache={cache()} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('Count')).toBeInTheDocument();
  expect(screen.getByText('Customers')).toBeInTheDocument();
});

test('an all-time metric gets no comparison row', () => {
  const { container } = render(<Card cls={cls} metrics={[{ ...arr, dateField: null }, uc]} cache={cache({ note: 'no_date_field', comparison: null })} comparisonOn compareLabel="Last Month" refreshing={false} onRetry={() => {}} />);
  expect(container.querySelector('.gy-compare')).toBeNull();
});

test('a recounted compareFact replaces the big number and drives the diff and the arrow', () => {
  const { container } = render(<Card cls={cls} metrics={[arr, uc]} cache={cache({ fact: 1_240_000, compareFact: 40_000, comparison: 50_000, diffPct: -20, trend: 'up' })} comparisonOn compareLabel="Previous 1 Days" onToggleDiff={() => {}} refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('40K')).toBeInTheDocument();
  expect(screen.queryByText('1.24M')).toBeNull();
  expect(screen.getByRole('button', { name: '−20.0%' })).toBeInTheDocument();
  expect(container.querySelector('.gy-trend')!.getAttribute('data-sign')).toBe('down');
  expect(container.querySelector('.gy-compare')!.textContent).toContain('vs Previous 1 Days');
});

test('the arrow before the number follows the comparison, or the series when comparison is off', () => {
  const { container, rerender } = render(<Card cls={cls} metrics={[arr, uc]} cache={cache({ trend: 'down' })} comparisonOn compareLabel="Last Month" refreshing={false} onRetry={() => {}} />);
  expect(container.querySelector('.gy-trend')!.getAttribute('data-sign')).toBe('up');
  rerender(<Card cls={cls} metrics={[arr, uc]} cache={cache({ trend: 'down' })} comparisonOn={false} compareLabel="Last Month" refreshing={false} onRetry={() => {}} />);
  expect(container.querySelector('.gy-trend')!.getAttribute('data-sign')).toBe('down');
});

test('plan and forecast stay off the card face; the number names them on hover', () => {
  const { container } = render(<Card cls={cls} metrics={[arr, uc]} cache={cache({ forecast: 1_500_000 })} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  expect(container.textContent).not.toMatch(/plan|forecast/i);
  expect(screen.getByText('1.24M')).toHaveAttribute('title', 'Plan 1.3M · Forecast 1.5M');
});

test('a failed recount (comparison null) shows a dash, never a mismatched diff', () => {
  const { container } = render(<Card cls={cls} metrics={[arr, uc]} cache={cache({ compareFact: null, comparison: null, diffPct: null })} comparisonOn compareLabel="Previous 10 Days" onToggleDiff={() => {}} refreshing={false} onRetry={() => {}} />);
  expect(container.querySelector('.gy-delta')!.textContent).toBe('—');
});
