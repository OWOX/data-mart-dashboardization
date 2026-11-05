import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';
import type { MetricDef, MetricResult } from '../types';

const m: MetricDef = { id: 'x', martId: 'c', alias: 'Orders', measure: { field: 'id', fn: 'COUNT' }, kind: 'flow', dateField: 'date', role: 'leading', source: 'schema', isUniqueCount: false, format: 'number', currency: null, plan: null, shown: true, forecast: null };
const res = (over: Partial<MetricResult>): MetricResult => ({ fact: 100, compareFact: null, comparison: 500, diffPct: null, plan: null, forecast: null, forecastApprox: false, status: 'neutral', trend: 'down', note: null, error: null, ...over });
const projection = { actual: 100, factWindow: { from: '2026-10-01', to: '2026-10-23' }, forecastWindow: { from: '2026-10-24', to: '2026-12-31' }, source: { kind: 'trend', days: 90 } } as const;

test('a projected result shows its forecast and the arrow measured from it', () => {
  render(<Badge metric={m} comparing result={res({ forecast: 900, projection })} />);
  expect(screen.getByText('900')).toBeInTheDocument();
  expect(screen.getByLabelText('trend up')).toBeInTheDocument();
});

test('an unprojected result shows the actual', () => {
  render(<Badge metric={m} comparing result={res({ forecast: 900 })} />);
  expect(screen.getByText('100')).toBeInTheDocument();
});
