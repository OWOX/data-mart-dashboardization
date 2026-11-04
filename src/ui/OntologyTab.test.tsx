import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OntologyTab } from './OntologyTab';
import { fakeOwox } from '../owox/fake';
import type { MartDetail, SchemaField } from '../owox/sources';
import type { MetricDef, Model } from '../types';

const field = (name: string, type = 'FLOAT'): SchemaField => ({ name, type, isPrimaryKey: false });
const detail = (id: string, title: string, fields = [field('revenue'), field('qty'), field('day', 'DATE')]): MartDetail => ({ id, title, fields });
const metric = (id: string, martId: string, alias: string, f: string, extra: Partial<MetricDef> = {}): MetricDef => ({
  id, martId, alias, measure: { field: f, fn: 'SUM' }, kind: 'flow', dateField: 'day', role: 'critical', source: 'project',
  isUniqueCount: false, plan: null, shown: true, forecast: null, ...extra,
});
const model = (): Model => ({
  version: 2, inputHash: 'h', builtAt: 'b', builtBy: 'u', editedAt: null,
  goal: { classId: 'a', metricId: 'a:revenue:SUM', goalMartId: 'a', viaFallback: false },
  classes: [
    { id: 'c', martId: 'c', title: 'Customers', contexts: [{ id: 'x', name: 'Sales' }], depth: 1, keyMetricId: 'c:qty:SUM', metricIds: ['c:qty:SUM'], shown: true },
    { id: 'a', martId: 'a', title: 'Orders', contexts: [], depth: 0, keyMetricId: 'a:revenue:SUM', metricIds: ['a:revenue:SUM', 'a:qty:SUM'], shown: true },
  ],
  edges: [],
  metrics: [metric('a:revenue:SUM', 'a', 'Revenue', 'revenue'), metric('a:qty:SUM', 'a', 'Units', 'qty', { role: 'leading' }), metric('c:qty:SUM', 'c', 'Customers', 'qty')],
});
const DETAILS = new Map([['a', detail('a', 'Orders')], ['c', detail('c', 'Customers')], ['p', detail('p', 'Targets', [field('goal'), field('stat_day', 'DATE'), field('note', 'STRING')])]]);
const MARTS: { id: string; title: string; description?: string | null }[] = [{ id: 'a', title: 'Orders' }, { id: 'c', title: 'Customers' }, { id: 'p', title: 'Targets' }];

const openAll = () => { for (const b of screen.queryAllByRole('button', { expanded: false })) fireEvent.click(b); };

function setup(m: Model = model(), details = DETAILS, marts: typeof MARTS | null = MARTS, open = true) {
  const onSave = vi.fn(async () => undefined);
  const onCancel = vi.fn();
  const owox = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: Object.fromEntries(details), blendables: {} });
  render(<OntologyTab model={m} details={details} marts={marts} owox={owox} now={() => new Date('2026-11-04T10:00:00Z')} onSave={onSave} onCancel={onCancel} />);
  if (open) openAll();
  return { onSave, onCancel };
}
const row = (name: string) => within(screen.getByRole('rowgroup', { name: `Metric ${name}` }));

test('says the changes are the member\'s own, lists the goal first and locks its checkbox', () => {
  setup();
  expect(screen.getByText('Your model. Changes here only affect what you see.')).toBeInTheDocument();
  const sections = screen.getAllByRole('region');
  expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(['Orders', 'Customers']);
  const goal = screen.getByRole('checkbox', { name: 'Orders' });
  expect(goal).toBeDisabled();
  expect(goal.closest('label')).toHaveAttribute('title', 'The goal is always shown');
  expect(screen.getByRole('checkbox', { name: 'Customers' })).toBeEnabled();
});

test('editing name, role, fact, plan and forecast, then Save, writes the doc with editedAt', async () => {
  const { onSave } = setup();
  const r = row('Units');
  fireEvent.change(r.getByLabelText('Name'), { target: { value: 'Items sold' } });
  fireEvent.change(r.getByLabelText('Role'), { target: { value: 'lagging' } });
  fireEvent.change(r.getByLabelText('Fact field'), { target: { value: 'revenue' } });
  fireEvent.change(r.getByLabelText('Fact aggregation'), { target: { value: 'AVG' } });
  fireEvent.change(r.getByLabelText('Fact date field'), { target: { value: '' } });
  fireEvent.change(r.getByLabelText('Plan data mart'), { target: { value: 'p' } });
  fireEvent.change(r.getByLabelText('Plan field'), { target: { value: 'goal' } });
  fireEvent.change(r.getByLabelText('Plan date field'), { target: { value: 'stat_day' } });
  fireEvent.change(r.getByLabelText('Plan shape'), { target: { value: 'cumulative' } });
  fireEvent.click(r.getByRole('combobox', { name: 'Forecast source' }));
  fireEvent.click(within(r.getByRole('group', { name: 'Targets' })).getByRole('option', { name: 'goal' }));
  fireEvent.change(r.getByLabelText('Forecast aggregation'), { target: { value: 'MAX' } });
  fireEvent.change(r.getByLabelText('Forecast date field'), { target: { value: 'stat_day' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  const saved = (onSave.mock.calls[0] as unknown as [Model])[0];
  expect(saved.editedAt).toBe('2026-11-04T10:00:00.000Z');
  expect(saved.metrics.find((m) => m.id === 'a:qty:SUM')).toMatchObject({
    alias: 'Items sold', role: 'lagging', measure: { field: 'revenue', fn: 'AVG' }, dateField: null,
    plan: { martId: 'p', measure: { field: 'goal', fn: 'SUM' }, dateField: 'stat_day', shape: 'cumulative' },
    forecast: { martId: 'p', measure: { field: 'goal', fn: 'MAX' }, dateField: 'stat_day' },
  });
  expect(saved.metrics.find((m) => m.id === 'a:revenue:SUM')).toEqual(model().metrics[0]);
});

test('the date pickers offer only date fields', () => {
  setup();
  const opts = within(row('Revenue').getByLabelText('Fact date field')).getAllByRole('option').map((o) => o.textContent);
  expect(opts).toEqual(['No date (all time)', 'day']);
});

test('Cancel writes nothing', () => {
  const { onSave, onCancel } = setup();
  fireEvent.change(row('Revenue').getByLabelText('Name'), { target: { value: 'X' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
});

test('unchecking a key metric moves the key; Save is refused when a shown class has no key', async () => {
  const { onSave } = setup();
  fireEvent.click(row('Revenue').getByLabelText('Shown'));
  expect(row('Units').getByLabelText('Key metric')).toBeChecked();
  expect(row('Revenue').getByLabelText('Key metric')).toBeDisabled();
  fireEvent.click(row('Units').getByLabelText('Shown'));
  // no shown metric is left: no key is needed
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  const saved = (onSave.mock.calls[0] as unknown as [Model])[0];
  expect(saved.classes.find((c) => c.id === 'a')!.keyMetricId).toBeNull();
  expect(saved.metrics.filter((m) => m.martId === 'a').every((m) => !m.shown)).toBe(true);
});

test('an empty name or a plan without a field stops the save', async () => {
  const { onSave } = setup();
  fireEvent.change(row('Revenue').getByLabelText('Plan data mart'), { target: { value: 'p' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The plan of Revenue needs a field and a date field');
  expect(onSave).not.toHaveBeenCalled();
});

test('a missing field is flagged red and the old value kept', () => {
  const details = new Map(DETAILS);
  details.set('a', detail('a', 'Orders', [field('qty'), field('day', 'DATE')]));
  setup(model(), details);
  const pick = row('Revenue').getByLabelText('Fact field') as HTMLSelectElement;
  expect(pick.value).toBe('revenue');
  expect(pick).toHaveClass('gy-bad');
  expect(within(pick).getByRole('option', { name: 'revenue (missing)' })).toBeDisabled();
  expect(row('Units').getByLabelText('Fact field')).not.toHaveClass('gy-bad');
});

test('a Data Mart that is gone is flagged on the plan select and on the class', () => {
  const m = model();
  m.metrics[0] = { ...m.metrics[0]!, plan: { martId: 'gone', measure: { field: 'goal', fn: 'SUM' }, dateField: 'stat_day', shape: 'daily' } };
  setup(m, DETAILS, MARTS);
  const plan = row('Revenue').getByLabelText('Plan data mart');
  expect(plan).toHaveClass('gy-bad');
  expect(within(plan).getByRole('option', { name: 'gone (missing)' })).toBeDisabled();
});

test('a Data Mart picked from the list has its schema fetched', async () => {
  const details = new Map(DETAILS);
  details.delete('p');
  const owox = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: Object.fromEntries(DETAILS), blendables: {} });
  render(<OntologyTab model={model()} details={details} marts={MARTS} owox={owox} now={() => new Date()} onSave={async () => undefined} onCancel={() => {}} />);
  openAll();
  fireEvent.change(row('Revenue').getByLabelText('Plan data mart'), { target: { value: 'p' } });
  await waitFor(() => expect(within(row('Revenue').getByLabelText('Plan field')).getByRole('option', { name: 'goal' })).toBeInTheDocument());
  expect(owox.calls.map((c) => c.path)).toContain('/api/data-marts/p');
});

test('a failed access check flags nothing, keeps values, and says so once', () => {
  const m = model();
  m.metrics[0] = { ...m.metrics[0]!, plan: { martId: 'gone', measure: { field: 'goal', fn: 'SUM' }, dateField: 'stat_day', shape: 'daily' } };
  setup(m, DETAILS, null);
  expect(screen.getAllByText("Couldn't check which Data Marts you can access; references aren't verified.")).toHaveLength(1);
  expect(document.querySelectorAll('.gy-bad')).toHaveLength(0);
  const plan = row('Revenue').getByLabelText('Plan data mart') as HTMLSelectElement;
  expect(plan.value).toBe('gone');
  // only the Data Marts the model already uses are offered
  expect(within(plan).getAllByRole('option').map((o) => o.getAttribute('value')).sort()).toEqual(['', 'a', 'c', 'gone']);
  expect((row('Revenue').getByLabelText('Fact field') as HTMLSelectElement).value).toBe('revenue');
});

test('a schema that fails to load says so instead of flagging missing', async () => {
  const details = new Map(DETAILS);
  details.delete('a');
  const owox = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {} });
  render(<OntologyTab model={model()} details={details} marts={MARTS} owox={owox} now={() => new Date()} onSave={async () => undefined} onCancel={() => {}} />);
  await waitFor(() => expect(screen.getAllByText("Couldn't read the schema").length).toBeGreaterThan(0));
  expect(document.querySelectorAll('.gy-bad')).toHaveLength(0);
  expect(screen.queryByText(/\(missing\)/)).toBeNull();
});

test('a class whose Data Mart is gone is flagged', () => {
  const details = new Map(DETAILS);
  details.delete('c');
  setup(model(), details, MARTS.filter((x) => x.id !== 'c'));
  expect(within(screen.getByRole('region', { name: 'Customers' })).getByText('Data Mart not found or not accessible')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Orders' })).queryByText('Data Mart not found or not accessible')).toBeNull();
});

test('schema fetches for referenced Data Marts run at most six at a time', async () => {
  const ids = Array.from({ length: 10 }, (_, i) => `m${i}`);
  const m = model();
  m.metrics = ids.map((id) => metric(`${id}:qty:SUM`, id, id, 'qty'));
  m.classes = [{ id: 'a', martId: 'a', title: 'Orders', contexts: [], depth: 0, keyMetricId: m.metrics[0]!.id, metricIds: m.metrics.map((x) => x.id), shown: true }];
  m.goal = { classId: 'a', metricId: m.metrics[0]!.id, goalMartId: 'a', viaFallback: false };
  const base = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: Object.fromEntries(ids.map((id) => [id, detail(id, id)])), blendables: {} });
  let active = 0, peak = 0;
  const owox = { ...base, getJson: (async (path: string) => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return base.getJson(path);
  }) as typeof base.getJson };
  render(<OntologyTab model={m} details={new Map()} marts={ids.map((id) => ({ id, title: id }))} owox={owox} now={() => new Date()} onSave={vi.fn(async () => undefined)} onCancel={vi.fn()} />);
  await waitFor(() => expect(base.calls.length).toBe(10));
  await new Promise((r) => setTimeout(r, 30));
  expect(peak).toBe(6);
});

const header = (name: string) => within(screen.getByRole('region', { name })).getAllByRole('button')[0]!;

test('class blocks are folded by default and open and close on click', () => {
  setup(model(), DETAILS, MARTS, false);
  const h = header('Orders');
  expect(h).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('rowgroup', { name: 'Metric Revenue' })).toBeNull();
  fireEvent.click(h);
  expect(h).toHaveAttribute('aria-expanded', 'true');
  expect(h.getAttribute('aria-controls')).toBe(document.getElementById(h.getAttribute('aria-controls')!)?.id);
  expect(screen.getByRole('rowgroup', { name: 'Metric Revenue' })).toBeInTheDocument();
  expect(screen.queryByRole('rowgroup', { name: 'Metric Customers' })).toBeNull();
  fireEvent.click(h);
  expect(h).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('rowgroup', { name: 'Metric Revenue' })).toBeNull();
});

test('the folded header shows the shown count and a broken count, and no input sits inside the button', () => {
  const m = model();
  m.metrics[1] = { ...m.metrics[1]!, shown: false };
  const details = new Map(DETAILS);
  details.set('a', detail('a', 'Orders', [field('qty'), field('day', 'DATE')]));
  setup(m, details, MARTS, false);
  const h = header('Orders');
  expect(h).toHaveTextContent('1 of 2 metrics shown');
  expect(h).toHaveTextContent('1 broken');
  expect(h.querySelector('input')).toBeNull();
  expect(header('Customers')).not.toHaveTextContent('broken');
  expect(screen.getByRole('checkbox', { name: 'Orders' })).toBeInTheDocument();
});

test('draft edits inside a block survive folding and Save', async () => {
  const { onSave } = setup();
  fireEvent.change(row('Revenue').getByLabelText('Name'), { target: { value: 'Sales' } });
  fireEvent.click(header('Orders'));
  expect(screen.queryByRole('rowgroup', { name: 'Metric Revenue' })).toBeNull();
  fireEvent.click(header('Orders'));
  expect((row('Revenue').getByLabelText('Name') as HTMLInputElement).value).toBe('Sales');
  fireEvent.click(header('Orders'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect((onSave.mock.calls[0] as unknown as [Model])[0].metrics[0]!.alias).toBe('Sales');
});

test('the (i) icons show the live mart and field descriptions, not the stored ones', () => {
  const m = model();
  m.metrics[0] = { ...m.metrics[0]!, description: 'stored text' };
  const details = new Map(DETAILS);
  details.set('a', detail('a', 'Orders', [{ ...field('revenue'), description: 'Live revenue' }, field('qty'), field('day', 'DATE')]));
  setup(m, details, MARTS.map((x) => (x.id === 'a' ? { ...x, description: 'Live orders mart' } : x)));
  expect(screen.getByRole('button', { name: 'About Orders' })).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Orders' })).getByRole('button', { name: 'About revenue' })).toBeInTheDocument();
  expect(screen.queryByText('stored text')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'About revenue' }));
  expect(screen.getByRole('tooltip')).toHaveTextContent('Live revenue');
  expect(screen.getByRole('button', { name: 'About Orders' })).toHaveAccessibleDescription('Live orders mart');
});

test('no (i) icon when the descriptions are empty', () => {
  const details = new Map(DETAILS);
  details.set('a', detail('a', 'Orders', [{ ...field('revenue'), description: '  ' }, field('qty'), field('day', 'DATE')]));
  setup(model(), details, MARTS.map((x) => (x.id === 'a' ? { ...x, description: '' } : x)));
  expect(document.querySelector('.gy-tip')).toBeNull();
});

const orderedMetric = (): Model => {
  const m = model();
  m.metrics[0] = { ...m.metrics[0]!,
    plan: { martId: 'p', measure: { field: 'goal', fn: 'SUM' }, dateField: 'stat_day', shape: 'daily' },
    forecast: { martId: 'p', measure: { field: 'goal', fn: 'SUM' }, dateField: 'stat_day' } };
  return m;
};

test('Plan, Forecast and nested fields show their live descriptions', () => {
  const details = new Map(DETAILS);
  details.set('p', detail('p', 'Targets', [
    { ...field('goal'), description: 'Plan goal' }, field('stat_day', 'DATE'),
    { name: 'meta', type: 'RECORD', isPrimaryKey: false, fields: [{ ...field('target'), description: 'Nested target' }] },
  ]));
  const m = orderedMetric();
  m.metrics[1] = { ...m.metrics[1]!, plan: { martId: 'p', measure: { field: 'meta.target', fn: 'SUM' }, dateField: 'stat_day', shape: 'daily' } };
  setup(m, details);
  expect(row('Revenue').getAllByRole('button', { name: 'About goal' })).toHaveLength(2);
  expect(row('Units').getByRole('button', { name: 'About meta.target' })).toHaveAccessibleDescription('Nested target');
});

test('the (i) opens on hover and focus, click does not close a focused one, Escape and blur close it', () => {
  const details = new Map(DETAILS);
  details.set('a', detail('a', 'Orders', [{ ...field('revenue'), description: 'Live revenue' }, field('qty'), field('day', 'DATE')]));
  setup(model(), details);
  const btn = screen.getByRole('button', { name: 'About revenue' });
  const tip = () => document.getElementById(btn.getAttribute('aria-describedby')!)!;
  expect(tip()).toHaveAttribute('hidden');
  fireEvent.mouseEnter(btn.parentElement!);
  expect(tip()).not.toHaveAttribute('hidden');
  fireEvent.mouseLeave(btn.parentElement!);
  expect(tip()).toHaveAttribute('hidden');
  fireEvent.focus(btn);
  expect(tip()).not.toHaveAttribute('hidden');
  fireEvent.click(btn);
  fireEvent.click(btn);
  expect(tip()).not.toHaveAttribute('hidden');
  fireEvent.keyDown(btn, { key: 'Escape' });
  expect(tip()).toHaveAttribute('hidden');
  fireEvent.click(btn);
  expect(tip()).not.toHaveAttribute('hidden');
  fireEvent.click(btn);
  expect(tip()).toHaveAttribute('hidden');
  fireEvent.click(btn);
  fireEvent.blur(btn);
  expect(tip()).toHaveAttribute('hidden');
});

test('aria-controls points at an existing element while folded', () => {
  setup(model(), DETAILS, MARTS, false);
  const h = header('Orders');
  expect(document.getElementById(h.getAttribute('aria-controls')!)).not.toBeNull();
});

test('broken count: a gone class counts 1 and its metrics add nothing', () => {
  const details = new Map(DETAILS);
  details.delete('a');
  setup(model(), details, MARTS.filter((x) => x.id !== 'a'), false);
  expect(header('Orders')).toHaveTextContent('1 broken');
});

test('broken count: a gone plan Data Mart is 1; a missing field and a non-date date field each add 1', () => {
  const m = orderedMetric();
  m.metrics[0] = { ...m.metrics[0]!, plan: { martId: 'gone', measure: { field: 'goal', fn: 'SUM' }, dateField: 'stat_day', shape: 'daily' } };
  // fact field missing, fact date field no longer a DATE, forecast date field missing
  m.metrics[1] = { ...m.metrics[1]!, measure: { field: 'nope', fn: 'SUM' }, dateField: 'qty',
    forecast: { martId: 'p', measure: { field: 'goal', fn: 'SUM' }, dateField: 'absent' } };
  setup(m, DETAILS, MARTS, false);
  // Revenue: plan gone 1 + forecast ok 0; Units: 1 + 1 + 1
  expect(header('Orders')).toHaveTextContent('4 broken');
  expect(header('Customers')).not.toHaveTextContent('broken');
});

test('the field lists show aliases and keep the field path as the value', () => {
  const details = new Map(DETAILS);
  details.set('a', detail('a', 'Orders', [{ ...field('revenue'), alias: 'Net revenue' }, field('qty'), field('day', 'DATE')]));
  setup(model(), details);
  const pick = row('Revenue').getByLabelText('Fact field') as HTMLSelectElement;
  expect(within(pick).getAllByRole('option').map((o) => o.textContent)).toEqual(['Net revenue', 'qty', 'day']);
  expect(pick.value).toBe('revenue');
});

test('each class lists its metrics as a table, one row per series', () => {
  setup();
  const table = within(screen.getByRole('region', { name: 'Orders' })).getByRole('table');
  expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(
    ['Shown', 'Key', 'Name', 'Role', 'Series', 'Data Mart', 'Field', 'Aggregation', 'Date field', 'Shape']);
  expect(row('Revenue').getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Fact', 'Plan', 'Forecast']);
});

test('the forecast list groups fields by Data Mart, reads the schemas it lacks, filters, and Extrapolated clears it', async () => {
  const details = new Map(DETAILS);
  details.delete('p');
  const owox = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: Object.fromEntries(DETAILS), blendables: {} });
  const onSave = vi.fn(async () => undefined);
  const m = orderedMetric();
  render(<OntologyTab model={m} details={details} marts={MARTS} owox={owox} now={() => new Date()} onSave={onSave} onCancel={() => {}} />);
  openAll();
  const box = row('Units').getByRole('combobox', { name: 'Forecast source' });
  expect(box).toHaveValue('Extrapolated');
  fireEvent.focus(box);
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.click(box);
  const list = () => screen.getByRole('listbox', { name: 'Forecast source' });
  await waitFor(() => expect(within(within(list()).getByRole('group', { name: 'Targets' })).getByRole('option', { name: 'goal' })).toBeInTheDocument());
  expect(owox.calls.map((c) => c.path)).toContain('/api/data-marts/p');
  // dates are not offered; strings are
  expect(within(within(list()).getByRole('group', { name: 'Targets' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['goal', 'note']);
  expect(within(list()).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Orders', 'Customers', 'Targets']);
  fireEvent.change(box, { target: { value: 'targ' } });
  expect(within(list()).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Targets']);
  // a filter highlights its first match
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(box).toHaveValue('Targets › goal');
  const rev = row('Revenue').getByRole('combobox', { name: 'Forecast source' });
  fireEvent.click(rev);
  // the list opens on the current choice
  expect(rev).toHaveAttribute('aria-activedescendant', within(list()).getByRole('option', { name: 'goal', selected: true }).id);
  fireEvent.click(within(list()).getByRole('option', { name: 'Extrapolated' }));
  expect(rev).toHaveValue('Extrapolated');
  fireEvent.change(row('Units').getByLabelText('Forecast date field'), { target: { value: 'stat_day' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  const saved = (onSave.mock.calls[0] as unknown as [Model])[0];
  expect(saved.metrics.find((x) => x.id === 'a:qty:SUM')!.forecast).toEqual({ martId: 'p', measure: { field: 'goal', fn: 'SUM' }, dateField: 'stat_day' });
  expect(saved.metrics.find((x) => x.id === 'a:revenue:SUM')!.forecast).toBeNull();
});

test('a forecast field that no longer exists turns the box red', () => {
  const m = orderedMetric();
  m.metrics[0] = { ...m.metrics[0]!, forecast: { martId: 'p', measure: { field: 'gone', fn: 'SUM' }, dateField: 'stat_day' } };
  setup(m);
  expect(row('Revenue').getByRole('combobox', { name: 'Forecast source' })).toHaveClass('gy-bad');
  expect(row('Units').getByRole('combobox', { name: 'Forecast source' })).not.toHaveClass('gy-bad');
});

test('aliases shared by several fields get the path added', () => {
  const details = new Map(DETAILS);
  details.set('a', detail('a', 'Orders', [{ ...field('revenue'), alias: 'Amount' }, { ...field('qty'), alias: 'Amount' }, field('day', 'DATE')]));
  setup(model(), details);
  expect(within(row('Revenue').getByLabelText('Fact field')).getAllByRole('option').map((o) => o.textContent))
    .toEqual(['Amount (revenue)', 'Amount (qty)', 'day']);
});

test('Enter on a forecast whose field is not listed changes nothing', async () => {
  const m = orderedMetric();
  m.metrics[0] = { ...m.metrics[0]!, forecast: { martId: 'p', measure: { field: 'gone', fn: 'MAX' }, dateField: 'stat_day' } };
  const { onSave } = setup(m);
  const box = row('Revenue').getByRole('combobox', { name: 'Forecast source' });
  fireEvent.keyDown(box, { key: 'ArrowDown' });
  expect(box).not.toHaveAttribute('aria-activedescendant');
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect((onSave.mock.calls[0] as unknown as [Model])[0].metrics[0]!.forecast).toEqual(m.metrics[0]!.forecast);
});
