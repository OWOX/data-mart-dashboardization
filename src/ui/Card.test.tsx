import { fireEvent, render, screen } from '@testing-library/react';
import { Card } from './Card';
import type { CardCache, ClassNode, MetricDef, MetricResult } from '../types';

const cls: ClassNode = { id: 'c', martId: 'c', title: 'Customers', contexts: [], depth: 0, keyMetricId: 'arr', metricIds: ['arr', 'uc'], shown: true };
const arr: MetricDef = { id: 'arr', martId: 'c', alias: 'ARR', measure: { field: 'arr', fn: 'SUM' }, kind: 'level', dateField: 'date', role: 'critical', source: 'project', isUniqueCount: false, format: 'number', currency: null, plan: null, shown: true, forecast: null };
const uc: MetricDef = { id: 'uc', martId: 'c', alias: 'Customers', measure: { field: 'id', fn: 'COUNT_DISTINCT' }, kind: 'flow', dateField: 'date', role: 'unique', source: 'schema', isUniqueCount: true, format: 'number', currency: null, plan: null, shown: true, forecast: null };
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

test('a percent metric shows % on the number, badge, plan and the absolute chip in pp', () => {
  const rate: MetricDef = { ...arr, format: 'percent' };
  const rc = res({ fact: 0.0402, comparison: 0.0282, plan: 0.05, diffPct: 42.6 });
  const c: CardCache = { metrics: { arr: rc, uc: res({ fact: 0.5, status: 'above', trend: 'down', plan: null }) }, spark: cache().spark };
  const { container } = render(<Card cls={cls} metrics={[rate, { ...uc, format: 'percent' }]} cache={c} comparisonOn compareLabel="Last Month" absolute refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('4.0%')).toBeInTheDocument();
  expect(screen.getByText('+1.2 pp')).toBeInTheDocument();
  expect(container.querySelector('.gy-badge')!.textContent).toMatch(/^50\.0% Customers/);
  expect(container.querySelector('.gy-big')!.getAttribute('title')).toBe('Plan 5.0%');
});

test('a currency metric shows its symbol', () => {
  const money: MetricDef = { ...arr, format: 'currency', currency: 'USD' };
  render(<Card cls={cls} metrics={[money]} cache={cache()} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('$1.24M')).toBeInTheDocument();
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

const extra = (n: number): MetricDef[] => Array.from({ length: n }, (_, i) => ({ ...uc, id: `m${i}`, alias: `Extra ${i}` }));
const many = (n: number) => {
  const ms = extra(n);
  const c: CardCache = { ...cache(), metrics: { ...cache().metrics, ...Object.fromEntries(ms.map((m) => [m.id, res({ fact: 5, plan: null })])) } };
  return render(<Card cls={{ ...cls, metricIds: ['arr', ...ms.map((m) => m.id)] }} metrics={[arr, ...ms]} cache={c} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
};

test('more than three secondary metrics: the rest open in a panel, and Show less, Escape or an outside click close it', () => {
  const { container } = many(5);
  const card = container.querySelector('.gy-card') as HTMLElement;
  expect(container.querySelectorAll('.gy-badge')).toHaveLength(3);
  expect(container.querySelector('.gy-badges-panel')).toBeNull();
  const btn = screen.getByRole('button', { name: 'Show +2 more' });
  expect(btn.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(btn);
  const panel = container.querySelector('.gy-badges-panel') as HTMLElement;
  expect(btn.getAttribute('aria-controls')).toBe(panel.id);
  expect(card.style.height).toBe('');
  expect(container.querySelector('.gy-badges')!.getAttribute('style')).toBeNull();
  // the three beside the number plus the panel are every secondary metric
  expect(container.querySelectorAll('.gy-badge')).toHaveLength(5);
  expect(panel.querySelectorAll('.gy-badge')).toHaveLength(2);
  for (let i = 0; i < 5; i++) expect(screen.getByRole('button', { name: `Show Extra ${i}` })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
  expect(container.querySelector('.gy-badges-panel')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show +2 more' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(container.querySelector('.gy-badges-panel')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show +2 more' }));
  fireEvent.pointerDown(panel);
  expect(container.querySelector('.gy-badges-panel')).not.toBeNull();
  fireEvent.pointerDown(document.body);
  expect(container.querySelector('.gy-badges-panel')).toBeNull();
});

test('three secondary metrics need no button', () => {
  const { container } = many(3);
  expect(container.querySelectorAll('.gy-badge')).toHaveLength(3);
  expect(screen.queryByRole('button', { name: /^Show (\+\d+ more|less)$/ })).toBeNull();
});

test('clicking a secondary metric makes it the main one and the old main takes its place', () => {
  const { container } = render(<Card cls={cls} metrics={[arr, uc]} cache={cache()} comparisonOn compareLabel="Last Month" refreshing={false} onRetry={() => {}} />);
  expect(container.querySelector('.gy-card-metric')!.textContent).toBe('ARR');
  fireEvent.click(screen.getByRole('button', { name: 'Show Customers' }));
  expect(container.querySelector('.gy-card-metric')!.textContent).toBe('Count');
  expect(container.querySelector('.gy-big')!.textContent).toBe('7.15K');
  expect(container.querySelector('.gy-card')!.getAttribute('data-status')).toBe('above');
  expect(container.querySelector('.gy-spark')).toBeNull();
  const badge = container.querySelector('.gy-badge')!;
  expect(badge.textContent).toMatch(/^1\.24M ARR/);
  fireEvent.click(screen.getByRole('button', { name: 'Show ARR' }));
  expect(container.querySelector('.gy-big')!.textContent).toBe('1.24M');
  expect(container.querySelector('.gy-spark')).not.toBeNull();
});

test('a swap keeps the picked metric in the list slot it came from', () => {
  const { container } = many(3);
  fireEvent.click(screen.getByRole('button', { name: 'Show Extra 1' }));
  expect([...container.querySelectorAll('.gy-badge-name')].map((n) => n.textContent)).toEqual(['Extra 0', 'ARR', 'Extra 2']);
});

test('the external link opens the Data Mart overview; with no onOpen there is none', () => {
  const onOpen = vi.fn();
  const { rerender } = render(<Card cls={cls} metrics={[arr, uc]} cache={cache()} comparisonOn={false} refreshing={false} projectId="p1" onOpen={onOpen} onRetry={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open Customers in OWOX' }));
  expect(onOpen).toHaveBeenCalledWith('/ui/p1/data-marts/c/overview');
  rerender(<Card cls={cls} metrics={[arr, uc]} cache={cache()} comparisonOn={false} refreshing={false} projectId="p1" onRetry={() => {}} />);
  expect(screen.queryByRole('button', { name: /in OWOX/ })).toBeNull();
});

test('the corner icons sit in one group the stylesheet shows on hover and focus', () => {
  const { container } = render(<Card cls={cls} mart={{ description: 'About', icon: null }} metrics={[arr, uc]} cache={cache()} comparisonOn={false} refreshing={false} onOpen={() => {}} onRetry={() => {}} />);
  const tools = container.querySelector('.gy-card-tools')!;
  expect(tools.querySelector('.gy-hint')).not.toBeNull();
  expect(tools.querySelector('[aria-label="Open Customers in OWOX"]')).not.toBeNull();
});

test('a warning on the key number shows the icon, with the text in the tooltip', () => {
  render(<Card cls={cls} metrics={[arr, uc]} cache={cache({ fact: null, warning: 'Field arr no longer exists in Customers' })} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  expect(screen.getByLabelText('Warning')).toBeInTheDocument();
  expect(screen.getByRole('tooltip')).toHaveTextContent('Field arr no longer exists in Customers');
});

test('a badge with a warning shows the icon with its text', () => {
  const c = cache();
  c.metrics.uc = { ...c.metrics.uc!, warning: 'Field id no longer exists' };
  const { container } = render(<Card cls={cls} metrics={[arr, uc]} cache={c} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  expect(container.querySelector('.gy-badge [aria-label="Warning"]')).not.toBeNull();
  expect(container.querySelector('.gy-badge .gy-warn')).toHaveAttribute('title', 'Field id no longer exists');
});

test('a class whose Data Mart is gone says so, like the no-access card', () => {
  render(<Card cls={cls} metrics={[arr, uc]} cache={cache()} missing comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('Data Mart not found or not accessible')).toBeInTheDocument();
  expect(screen.getByLabelText('Warning')).toBeInTheDocument();
  expect(screen.queryByText('1.24M')).toBeNull();
});

test('a failed key metric keeps the card: dash, error in the tooltip, badges, and a Retry button', () => {
  const onRetry = vi.fn();
  const { container } = render(<Card cls={cls} metrics={[arr, uc]} cache={cache({ fact: null, error: 'TIMEOUT' })} comparisonOn compareLabel="Last Month" refreshing={false} onRetry={onRetry} />);
  expect(screen.getByText('—')).toBeInTheDocument();
  expect(screen.getByRole('tooltip')).toHaveTextContent('TIMEOUT');
  expect(container.querySelector('.gy-badge')!.textContent).toMatch(/^7\.15K Customers/);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('a caught rejection (warning only) shows the same way', () => {
  render(<Card cls={cls} metrics={[arr, uc]} cache={cache({ fact: null, warning: 'Not found' })} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('—')).toBeInTheDocument();
  expect(screen.getByRole('tooltip')).toHaveTextContent('Not found');
});

test('missing wins over noAccess; a plain noAccess keeps its text', () => {
  const { rerender } = render(<Card cls={cls} metrics={[arr]} cache={cache()} missing noAccess comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('Data Mart not found or not accessible')).toBeInTheDocument();
  rerender(<Card cls={cls} metrics={[arr]} cache={cache()} noAccess comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText("You don't have access to this Data Mart")).toBeInTheDocument();
});
