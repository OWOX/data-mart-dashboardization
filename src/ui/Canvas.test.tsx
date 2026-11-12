import { fireEvent, render, screen } from '../test-host';
import { Canvas, orbitCurve } from './Canvas';
import type { CacheDoc, Model } from '../types';

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
  render(<Canvas mode="flow" model={model} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
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
  render(<Canvas mode="flow" model={rich} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sales' }));
  expect(screen.queryByText('Alpha')).toBeNull();
  expect(screen.getByText('Beta')).toBeInTheDocument();
  expect(screen.getByText('Main')).toBeInTheDocument();
});

test('bridged connector is dashed', () => {
  const { container } = render(<Canvas mode="flow" model={rich} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(container.querySelectorAll('path[data-dashed="false"]')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Sales' }));
  const lines = container.querySelectorAll('path[data-from]');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toHaveAttribute('data-from', 'm');
  expect(lines[0]).toHaveAttribute('data-to', 'b');
  expect(lines[0]).toHaveAttribute('data-dashed', 'true');
});

test('loading line only while refreshing, determinate once the total is known', () => {
  const { container, rerender } = render(<Canvas mode="flow" model={rich} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.queryByRole('progressbar')).toBeNull();
  rerender(<Canvas mode="flow" model={rich} cache={null} comparisonOn refreshing onRetry={() => {}} />);
  expect(screen.getByRole('progressbar', { name: 'Loading data' })).not.toHaveAttribute('aria-valuenow');
  rerender(<Canvas mode="flow" model={rich} cache={null} comparisonOn refreshing progress={{ done: 2, total: 8 }} onRetry={() => {}} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  expect(container.querySelector('.gy-bands')).not.toHaveAttribute('inert');
  expect(container.querySelector('.gy-overlay')).toBeNull();
});

test('retry on error card calls onRetry', () => {
  const onRetry = vi.fn();
  const cache = { cards: { m: { metrics: { k: { error: 'boom', fact: null, trend: 'flat', status: 'neutral' } }, spark: null } } } as never;
  render(<Canvas mode="flow" model={rich} cache={cache} comparisonOn refreshing={false} onRetry={onRetry} />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('stale selection is dropped when the context disappears', () => {
  const { rerender } = render(<Canvas mode="flow" model={rich} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sales' }));
  const without = { ...rich, classes: rich.classes.map((c) => ({ ...c, contexts: c.contexts.filter((x) => x.id !== 's') })) } as Model;
  rerender(<Canvas mode="flow" model={without} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Beta')).toBeInTheDocument();
});

test('classes the member cannot see still render, as no-access cards', () => {
  render(<Canvas mode="flow" model={rich} visibleIds={new Set(['m', 'b'])} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('Alpha')).toBeInTheDocument();
  expect(screen.getAllByText("You don't have access to this Data Mart")).toHaveLength(1);
});

test('an invisible main class shows the no-access card instead of metrics', () => {
  const cache = { cards: { m: { metrics: { k: { fact: 5, error: null, status: 'neutral' } }, spark: null } } } as never;
  render(<Canvas mode="flow" model={rich} visibleIds={new Set(['a'])} cache={cache} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('Main')).toBeInTheDocument();
  expect(screen.getAllByText("You don't have access to this Data Mart")).toHaveLength(2);
});

test('main sits alone in the Goal band; every other class shares the Drivers band', () => {
  const { container } = render(<Canvas mode="flow" model={rich} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  const [goal, drivers] = [...container.querySelectorAll('.gy-band')] as [Element, Element];
  expect([...goal.querySelectorAll('[data-class-id]')].map((e) => e.getAttribute('data-class-id'))).toEqual(['m']);
  expect([...drivers.querySelectorAll('[data-class-id]')].map((e) => e.getAttribute('data-class-id'))).toEqual(['a', 'b']);
  expect(container.querySelector('path[data-from="a"][data-to="b"]')).toHaveClass('join');
  expect(container.querySelector('path[data-from="m"][data-to="a"]')).toHaveClass('feeds');
});

test('a line wears the plan status of the calculated metric it stands for', async () => {
  const { lineTone } = await import('./Canvas');
  const m = {
    ...rich,
    metrics: [...rich.metrics, { ...rich.metrics[0], id: 'k2', measure: { field: 'ltv', fn: null }, calculated: true }],
    classes: rich.classes.map((c) => (c.id === 'm' ? { ...c, metricIds: ['k', 'k2'] } : c)),
  } as unknown as Model;
  const line = { from: 'm', to: 'a', dashed: false, join: false, fields: ['ltv'] };
  const cache = (status: string) => ({ cards: { m: { metrics: { k2: { status, error: null } }, spark: null } } }) as never;
  expect(lineTone(line, m, cache('below'))).toBe('below');
  expect(lineTone(line, m, cache('above'))).toBe('above');
  expect(lineTone(line, m, null)).toBe('neutral');
  expect(lineTone({ ...line, fields: ['other'] }, m, null)).toBe('none');
  expect(lineTone({ ...line, fields: [] }, m, null)).toBe('none');
  // A metric on the same field that is not a calculated field does not colour the line.
  const plain = { ...m, metrics: m.metrics.map((x) => (x.id === 'k2' ? { ...x, calculated: false } : x)) } as Model;
  expect(lineTone(line, plain, cache('below'))).toBe('none');
});

test('the canvas shows no period block (it lives in the header); no driver count', () => {
  const { container } = render(<Canvas mode="flow" model={rich} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(container.querySelector('.gy-period-shown')).toBeNull();
  expect(container.querySelector('.gy-band-count')).toBeNull();
});

test('toolbar tools sit in the same row as the context chips', () => {
  const { container } = render(<Canvas mode="flow" model={model} cache={null} comparisonOn refreshing={false} onRetry={() => {}} tools={<button type="button" aria-label="Date range" />} />);
  const toolbar = container.querySelector('.gy-toolbar')!;
  expect(toolbar.querySelector('.gy-chips')).not.toBeNull();
  expect(toolbar.querySelector('.gy-toolbar-end [aria-label="Date range"]')).not.toBeNull();
});

test('a hidden class is not drawn, and a hidden goal class still is', () => {
  const hidden = { ...rich, classes: rich.classes.map((c) => ({ ...c, shown: c.id === 'b' })) } as Model;
  const { container } = render(<Canvas mode="flow" model={hidden} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect([...container.querySelectorAll('[data-class-id]')].map((e) => e.getAttribute('data-class-id'))).toEqual(['m', 'b']);
  expect(screen.queryByText('Alpha')).toBeNull();
});

const onto = {
  goal: { classId: 'm' },
  classes: [
    { id: 'm', martId: 'm', title: 'Orders', depth: 0, keyMetricId: 'k', metricIds: ['k'], core: false, inbound: 0, contexts: [] },
    { id: 'c', martId: 'c', title: 'Customers', depth: 1, keyMetricId: null, metricIds: [], core: true, inbound: 3, contexts: [] },
    { id: 'x', martId: 'x', title: 'Hidden', depth: 1, keyMetricId: null, metricIds: [], core: false, inbound: 0, contexts: [] },
  ],
  edges: [{ from: 'm', to: 'c' }, { from: 'm', to: 'x' }],
  metrics: [],
} as unknown as Model;

test('the ontology mode shows names only', () => {
  const withNumbers = { cards: { m: { metrics: { k: { status: 'above', value: 1240000, display: '$1.24M', series: [1, 2, 3] } } } } } as unknown as CacheDoc;
  const { container } = render(<Canvas mode="ontology" model={onto} cache={withNumbers} comparisonOn refreshing onRetry={() => {}} />);
  expect(screen.queryByText('$1.24M')).toBeNull();
  expect(screen.getByText('Customers')).toBeInTheDocument();
  expect(screen.getByText('Orders')).toBeInTheDocument();
  expect(screen.queryByText('Hidden')).toBeNull();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.queryByText('Goal')).toBeNull();
  expect(container.querySelector('.gy-spark')).toBeNull();
  expect(container.querySelector('[data-goal="true"]')).not.toBeNull();
});

test('the ontology mode with no core classes says so', () => {
  const none = { ...onto, classes: onto.classes.map((x) => ({ ...x, core: false })) } as Model;
  render(<Canvas mode="ontology" model={none} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('No core classes yet. An admin can set them in Settings, Checkup.')).toBeInTheDocument();
});

const orbitOf = (n: number) => ({
  goal: { classId: 'g' },
  classes: [
    { id: 'g', martId: 'g', title: 'Goal class', depth: 0, keyMetricId: null, metricIds: [], core: false, inbound: 0, contexts: [] },
    ...Array.from({ length: n }, (_, i) => ({ id: `c${i}`, martId: `c${i}`, title: `Core ${i}`, depth: 1, keyMetricId: null, metricIds: [], core: true, inbound: 10 - i, contexts: [{ id: i === 0 ? 'only' : 'other', name: i === 0 ? 'Only' : 'Other' }] })),
  ],
  edges: [{ from: 'g', to: 'c0' }],
  metrics: [],
}) as unknown as Model;

const cell = (c: Element, id: string) => c.querySelector(`[data-class-id="${id}"]`)!.parentElement as HTMLElement;

test('core cards sit top, right, bottom, left, then the corners around the centered goal', () => {
  const spots = ['2/1', '3/2', '2/3', '1/2', '3/1', '3/3', '1/3', '1/1'];
  for (const n of [3, 7]) {
    const { container, unmount } = render(<Canvas mode="ontology" model={orbitOf(n)} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
    expect(container.querySelector('ul.gy-orbit')).not.toBeNull();
    const g = cell(container, 'g');
    expect([g.style.gridColumn, g.style.gridRow]).toEqual(['2', '2']);
    for (let i = 0; i < n; i++) {
      const el = cell(container, `c${i}`);
      expect(`${el.style.gridColumn}/${el.style.gridRow}`).toBe(spots[i]);
    }
    expect(container.querySelector('[data-goal="true"] .gy-sr')?.textContent).toBe('Goal: ');
    unmount();
  }
});

test('ontology lines are solid and uncoloured', () => {
  const { container } = render(<Canvas mode="ontology" model={orbitOf(3)} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  const lines = container.querySelectorAll('path[data-from]');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toHaveAttribute('data-tone', 'none');
  expect(lines[0]).toHaveAttribute('data-dashed', 'false');
});

test('the ontology chips list only contexts of core classes', () => {
  const m = orbitOf(2);
  m.classes[0]!.contexts = [{ id: 'goalonly', name: 'GoalOnly' }];
  render(<Canvas mode="ontology" model={m} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.getByRole('button', { name: 'Only' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'GoalOnly' })).toBeNull();
});

test('an orbit line between opposite cards bends clear of the goal box', () => {
  const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
  const top = box(300, 0, 200, 100);
  const bottom = box(300, 500, 200, 100);
  const goal = box(250, 200, 300, 200);
  const d = orbitCurve(top, bottom, goal);
  const [sx, sy, cx, cy, ex, ey] = d.match(/-?\d+(\.\d+)?/g)!.map(Number) as number[];
  expect(cx !== undefined && cy !== undefined).toBe(true);
  const inside = (x: number, y: number) => x > goal.left && x < goal.right && y > goal.top && y < goal.bottom;
  expect(inside(cx!, cy!)).toBe(false);
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const x = (1 - t) ** 2 * sx! + 2 * (1 - t) * t * cx! + t * t * ex!;
    const y = (1 - t) ** 2 * sy! + 2 * (1 - t) * t * cy! + t * t * ey!;
    expect(inside(x, y)).toBe(false);
  }
});
