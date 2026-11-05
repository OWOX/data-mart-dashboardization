import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Card } from './Card';
import type { QualitySummary } from '../owox/quality';
import type { MartDetail } from '../owox/sources';
import { createMarkdownHtml } from '../lib/markdown';
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

test('header shows the mart kind glyph; the top-right info hint carries only the Data Mart description', () => {
  const described = { ...arr, description: 'Annual recurring revenue at period end' };
  const { container } = render(<Card cls={cls} mart={{ description: 'One row per paying customer', icon: 'customers' }} metrics={[described, uc]} cache={cache({})} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(container.querySelector('.gy-logo svg')).not.toBeNull();
  const hint = screen.getByLabelText(`About ${cls.title}`);
  expect(hint.textContent).toBe('One row per paying customer');
});

test('no info hint when the Data Mart has no description, even if its metrics do', () => {
  render(<Card cls={cls} mart={{ description: '  ', icon: null }} metrics={[{ ...arr, description: 'stored' }, uc]} cache={cache({})} comparisonOn refreshing={false} onRetry={() => {}} />);
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
  for (let i = 0; i < 5; i++) expect(screen.getByRole('button', { name: `Show Extra ${i}, 5` })).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole('button', { name: 'Show Customers, 7.15K' }));
  expect(container.querySelector('.gy-card-metric')!.textContent).toBe('Count');
  expect(container.querySelector('.gy-big')!.textContent).toBe('7.15K');
  expect(container.querySelector('.gy-card')!.getAttribute('data-status')).toBe('above');
  expect(container.querySelector('.gy-spark')).toBeNull();
  const badge = container.querySelector('.gy-badge')!;
  expect(badge.textContent).toMatch(/^1\.24M ARR/);
  fireEvent.click(screen.getByRole('button', { name: 'Show ARR, 1.24M' }));
  expect(container.querySelector('.gy-big')!.textContent).toBe('1.24M');
  expect(container.querySelector('.gy-spark')).not.toBeNull();
});

test('a swap keeps the picked metric in the list slot it came from', () => {
  const { container } = many(3);
  fireEvent.click(screen.getByRole('button', { name: 'Show Extra 1, 5' }));
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

test('a new key metric on the class drops the swap', () => {
  const props = { metrics: [arr, uc], cache: cache(), comparisonOn: false, refreshing: false, onRetry: () => {} };
  const { container, rerender } = render(<Card cls={cls} {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show Customers, 7.15K' }));
  expect(container.querySelector('.gy-big')!.textContent).toBe('7.15K');
  rerender(<Card cls={{ ...cls, keyMetricId: 'uc' }} {...props} />);
  expect(container.querySelector('.gy-big')!.textContent).toBe('7.15K');
  rerender(<Card cls={cls} {...props} />);
  expect(container.querySelector('.gy-big')!.textContent).toBe('1.24M');
});

test('Escape closing the panel does not reach other listeners', () => {
  many(5);
  const other = vi.fn();
  window.addEventListener('keydown', other);
  fireEvent.click(screen.getByRole('button', { name: 'Show +2 more' }));
  fireEvent.keyDown(document.body, { key: 'Escape' });
  window.removeEventListener('keydown', other);
  expect(other).not.toHaveBeenCalled();
});

test('the sparkline slot keeps its place after a swap, as an empty aria-hidden placeholder', () => {
  const { container } = render(<Card cls={cls} metrics={[arr, uc]} cache={cache()} comparisonOn compareLabel="Last Month" refreshing={false} onRetry={() => {}} />);
  expect(container.querySelector('.gy-spark')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show Customers, 7.15K' }));
  const slot = container.querySelector('.gy-spark-slot')!;
  expect(slot).not.toBeNull();
  expect(slot.getAttribute('aria-hidden')).toBe('true');
  expect(slot.textContent).toBe('');
});

test('a badge names its whole value and label in a title', () => {
  const { container } = render(<Card cls={cls} metrics={[arr, uc]} cache={cache()} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  expect(container.querySelector('.gy-badge')!.getAttribute('title')).toBe('7.15K Customers');
});

describe('data quality icon', () => {
  const q = (over: Partial<QualitySummary>): QualitySummary => ({ state: 'PASSED', enabledChecks: 5, passedChecks: 5, failedChecks: 0, errorChecks: 0, warningFindings: 0, errorFindings: 0, highestSeverity: null, lastRunAt: null, ...over });
  const show = (quality?: QualitySummary, onOpen = vi.fn()) => {
    render(<Card cls={cls} metrics={[arr, uc]} cache={cache()} comparisonOn={false} refreshing={false} projectId="p1" quality={quality} onOpen={onOpen} onRetry={() => {}} />);
    return onOpen;
  };

  test.each([
    [q({}), 'Data quality: all 5 checks passed', 'ok', 'shield-check'],
    [q({ passedChecks: 1 }), 'Data quality: all 1 check passed', 'ok', 'shield-check'],
    [q({ state: 'ISSUES', failedChecks: 3, highestSeverity: 'error' }), 'Data quality: 3 issues', 'bad', 'shield-alert'],
    [q({ state: 'ISSUES', failedChecks: 1, highestSeverity: 'warning' }), 'Data quality: 1 issue', 'warn', 'shield-alert'],
    [q({ state: 'EXECUTION_FAILED' }), 'Data quality checks failed to run', 'bad', 'shield-x'],
  ])('%#: name, colour and icon', (summary, name, tone, icon) => {
    show(summary);
    const b = screen.getByRole('button', { name });
    expect(b.getAttribute('data-tone')).toBe(tone);
    expect(b.querySelector(`.lucide-${icon}`)).not.toBeNull();
  });

  test('focusing the shield shows its label as a tooltip', () => {
    show(q({ state: 'ISSUES', failedChecks: 2, highestSeverity: 'warning' }));
    const b = screen.getByRole('button', { name: 'Data quality: 2 issues' });
    b.focus();
    expect(b).toHaveFocus();
    expect(b.querySelector('[role="tooltip"]')!.textContent).toBe('Data quality: 2 issues');
  });

  test('missing counts read as 0, never NaN', () => {
    show({ state: 'ISSUES' } as QualitySummary);
    expect(screen.getByRole('button', { name: 'Data quality: 0 issues' })).toBeInTheDocument();
  });

  test.each(['NEVER_RUN', 'QUEUED', 'RUNNING', 'RESTRICTED', 'CANCELLED', 'ALL_DISABLED'])('%s shows no icon', (state) => {
    show(q({ state }));
    expect(screen.queryByRole('button', { name: /Data quality/ })).toBeNull();
  });

  test('no summary, no icon', () => {
    show(undefined);
    expect(screen.queryByRole('button', { name: /Data quality/ })).toBeNull();
  });

  test('the click opens the quality page', () => {
    const onOpen = show(q({}));
    fireEvent.click(screen.getByRole('button', { name: /Data quality/ }));
    expect(onOpen).toHaveBeenCalledWith('/ui/p1/data-marts/c/quality');
  });
});

test('the big arrow follows the shown metric after a swap, with comparison on or off', () => {
  for (const on of [false, true]) {
    const c: CardCache = { ...cache(), metrics: { arr: res({ trend: 'up', comparison: null, compareFact: null }), uc: res({ fact: 7148, trend: 'down', comparison: null, compareFact: null }) } };
    const { container, unmount } = render(<Card cls={cls} metrics={[arr, uc]} cache={c} comparisonOn={on} compareLabel="Last Month" refreshing={false} onRetry={() => {}} />);
    expect(container.querySelector('.gy-trend')!.getAttribute('data-sign')).toBe('up');
    fireEvent.click(screen.getByRole('button', { name: 'Show Customers, 7.15K' }));
    expect(container.querySelector('.gy-trend')!.getAttribute('data-sign')).toBe('down');
    expect(container.querySelector('.gy-trend-arrow')!.getAttribute('aria-label')).toBe('direction down');
    unmount();
  }
});

const mdetail = (fields: MartDetail['fields']): ReadonlyMap<string, MartDetail> => new Map([['c', { id: 'c', title: 'Customers', fields }]]);
const FIELDS = [
  { name: 'arr', type: 'FLOAT', isPrimaryKey: false, alias: 'Annual revenue', description: '  Recurring revenue at period end  ' },
  { name: 'id', type: 'STRING', isPrimaryKey: true, alias: 'Customer id', description: 'Key of the customer' },
];

test('metric names come from the live field alias, else the field name, else the stored alias', () => {
  const { container, rerender } = render(<Card cls={cls} metrics={[arr, uc]} cache={cache()} details={mdetail(FIELDS)} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  expect(container.querySelector('.gy-card-metric')!.textContent).toBe('Annual revenue');
  expect(screen.getByRole('button', { name: 'Show Customers, 7.15K' })).toBeInTheDocument(); // the unique count keeps its label
  fireEvent.click(screen.getByRole('button', { name: 'Show Customers, 7.15K' }));
  expect(screen.getByRole('button', { name: 'Show Annual revenue, 1.24M' })).toBeInTheDocument();
  expect(container.querySelector('.gy-badge')!.getAttribute('title')).toBe('1.24M Annual revenue');
  rerender(<Card cls={cls} metrics={[arr, uc]} cache={cache()} details={mdetail([{ name: 'arr', type: 'FLOAT', isPrimaryKey: false }])} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show arr, 1.24M' }));
  expect(container.querySelector('.gy-card-metric')!.textContent).toBe('arr');
  rerender(<Card cls={cls} metrics={[arr, uc]} cache={cache()} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  expect(container.querySelector('.gy-card-metric')!.textContent).toBe('ARR');
});

test('an (i) by the main metric name shows the live field description, follows a swap, and is absent without one', () => {
  render(<Card cls={cls} metrics={[arr, uc]} cache={cache()} details={mdetail(FIELDS)} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  const tip = screen.getByLabelText('About Annual revenue');
  expect(tip.textContent).toBe('Recurring revenue at period end');
  expect(tip).toHaveAttribute('data-open', 'false');
  fireEvent.focus(tip);
  expect(tip).toHaveAttribute('data-open', 'true');
  fireEvent.keyDown(tip, { key: 'Escape' });
  expect(tip).toHaveAttribute('data-open', 'false');
  // a swapped-in unique count has no description of its own to show
  fireEvent.click(screen.getByRole('button', { name: 'Show Customers, 7.15K' }));
  expect(screen.queryByLabelText('About Annual revenue')).toBeNull();
  expect(screen.queryByLabelText('About Count')).toBeNull();
});

test('the metric (i) follows the swapped-in metric and is absent when its field has no description', () => {
  const two: MetricDef = { ...arr, id: 'two', alias: 'Two', measure: { field: 'two', fn: 'SUM' } };
  const c2: ClassNode = { ...cls, metricIds: ['arr', 'two'] };
  const fields = [...FIELDS, { name: 'two', type: 'FLOAT', isPrimaryKey: false, alias: 'Second', description: 'Second description' }];
  const cc: CardCache = { ...cache(), metrics: { arr: res({}), two: res({ fact: 5 }) } };
  const { rerender } = render(<Card cls={c2} metrics={[arr, two]} cache={cc} details={mdetail(fields)} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show Second, 5' }));
  expect(screen.getByLabelText('About Second').textContent).toBe('Second description');
  rerender(<Card cls={c2} metrics={[arr, two]} cache={cc} details={mdetail([fields[0]!, { ...fields[2]!, description: '  ' }])} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  expect(screen.queryByLabelText('About Second')).toBeNull();
  expect(document.querySelector('.gy-metric-tip')).toBeNull();
});

test('the Data Mart (i) shows raw text first, then OWOX-rendered HTML once, with links opening in a new tab', async () => {
  const parse = vi.fn(async ({ markdown }: { markdown: string }) => `<h2>Title</h2><p>${markdown}</p><a href="https://x.test">link</a>`);
  const markdown = createMarkdownHtml(parse);
  const { container } = render(<Card cls={cls} mart={{ description: ' **bold** ', icon: null }} metrics={[arr, uc]} cache={cache()} markdown={markdown} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  const hint = screen.getByLabelText(`About ${cls.title}`);
  expect(hint.textContent).toBe('**bold**');
  expect(parse).not.toHaveBeenCalled();
  fireEvent.mouseEnter(hint);
  await waitFor(() => expect(container.querySelector('.gy-md h2')?.textContent).toBe('Title'));
  const a = container.querySelector('.gy-md a')!;
  expect(a.getAttribute('target')).toBe('_blank');
  expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  fireEvent.mouseLeave(hint);
  fireEvent.mouseEnter(hint);
  expect(parse).toHaveBeenCalledTimes(1);
});

test('the rendered description is cached per mart across cards', async () => {
  const parse = vi.fn(async () => '<p>cached</p>');
  const markdown = createMarkdownHtml(parse);
  const props = { cls, mart: { description: 'text', icon: null }, metrics: [arr, uc], cache: cache(), markdown, comparisonOn: false, refreshing: false, onRetry: () => {} };
  const first = render(<Card {...props} />);
  fireEvent.focus(screen.getByLabelText(`About ${cls.title}`));
  await waitFor(() => expect(first.container.querySelector('.gy-md')).not.toBeNull());
  first.unmount();
  const second = render(<Card {...props} />);
  expect(second.container.querySelector('.gy-md')!.textContent).toBe('cached');
  expect(parse).toHaveBeenCalledTimes(1);
});

test('a failed or missing markdown call leaves the raw text', async () => {
  const parse = vi.fn(async () => { throw new Error('500'); });
  const props = { cls, mart: { description: 'plain\ntext', icon: null }, metrics: [arr, uc], cache: cache(), comparisonOn: false, refreshing: false, onRetry: () => {} };
  const failing = render(<Card {...props} markdown={createMarkdownHtml(parse)} />);
  fireEvent.focus(screen.getByLabelText(`About ${cls.title}`));
  await act(async () => { await Promise.resolve(); });
  expect(parse).toHaveBeenCalled();
  expect(failing.container.querySelector('.gy-md')).toBeNull();
  expect(failing.container.querySelector('.gy-hint-about')!.textContent).toBe('plain\ntext');
  failing.unmount();
  const none = render(<Card {...props} markdown={createMarkdownHtml(undefined)} />);
  fireEvent.focus(screen.getByLabelText(`About ${cls.title}`));
  expect(none.container.querySelector('.gy-hint-about')!.textContent).toBe('plain\ntext');
});

test('a metric wears the same arrow as a badge and as the main number, falling series or not', () => {
  // a falling series that still beats the comparison
  const c: CardCache = { ...cache(), metrics: { arr: res({ trend: 'up', fact: 100, comparison: 100, compareFact: null }), uc: res({ fact: 150, comparison: 100, compareFact: null, trend: 'down' }) } };
  const { container } = render(<Card cls={cls} metrics={[arr, uc]} cache={c} comparisonOn compareLabel="Last Month" refreshing={false} onRetry={() => {}} />);
  const badge = screen.getByRole('button', { name: 'Show Customers, 150' });
  expect(badge.querySelector('[aria-label="trend up"]')).not.toBeNull();
  fireEvent.click(badge);
  expect(container.querySelector('.gy-trend')!.getAttribute('data-sign')).toBe('up');
  // comparison off: both fall back to the series' own trend
  const off = render(<Card cls={cls} metrics={[arr, uc]} cache={c} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  expect(off.container.querySelector('.gy-badge [aria-label="trend down"]')).not.toBeNull();
});

test('card tips are shown by data-open alone, so Escape hides them; they name their bubble for screen readers', () => {
  render(<Card cls={cls} metrics={[arr, uc]} cache={cache()} details={mdetail(FIELDS)} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  const tip = screen.getByLabelText('About Annual revenue');
  expect(tip).toHaveAttribute('role', 'button');
  expect(document.getElementById(tip.getAttribute('aria-describedby')!)).toHaveAttribute('role', 'tooltip');
  fireEvent.mouseEnter(tip);
  fireEvent.keyDown(tip, { key: 'Escape' });
  expect(tip).toHaveAttribute('data-open', 'false');
  // the hover and focus rules must not apply to card tips
  const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');
  const rule = css.split('\n').find((l) => l.includes('.gy-hint:not(.gy-cardtip):hover .gy-hint-body'))!;
  expect(rule).toBeDefined();
  expect(css).not.toMatch(/\.gy-hint:hover \.gy-hint-body/);
  expect(css).toMatch(/\.gy-hint-about \{ white-space: pre-wrap/);
});

test('a parse result for a description that changed meanwhile is dropped', async () => {
  let release: (h: string) => void = () => {};
  const markdown = createMarkdownHtml(() => new Promise<string>((r) => { release = r; }));
  const props = { cls, metrics: [arr, uc], cache: cache(), markdown, comparisonOn: false, refreshing: false, onRetry: () => {} };
  const { container, rerender } = render(<Card {...props} mart={{ description: 'old', icon: null }} />);
  fireEvent.focus(screen.getByLabelText(`About ${cls.title}`));
  rerender(<Card {...props} mart={{ description: 'new', icon: null }} />);
  await act(async () => { release('<p>stale</p>'); });
  expect(container.querySelector('.gy-md')).toBeNull();
  expect(container.querySelector('.gy-hint-about')!.textContent).toBe('new');
});
