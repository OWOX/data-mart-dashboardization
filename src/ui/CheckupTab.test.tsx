import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CheckupTab } from './CheckupTab';
import type { Check, Suggestion } from '../checkup/types';

const ck = (id: string, status: Check['status'], over: Partial<Check> = {}): Check => ({ id, group: 'critical', purpose: 'What the check is for.', label: id, status, ...over });
const now = () => new Date(2026, 10, 4, 14, 2);

function deferred() {
  let resolve!: (c: Check[]) => void;
  const promise = new Promise<Check[]>((r) => { resolve = r; });
  return { promise, resolve };
}

const instant = (list: Check[]) => async (onUpdate: (c: Check[]) => void) => { onUpdate(list); return list; };

test('runs on mount, draws running checks, then the final list with summary and time', async () => {
  const d = deferred();
  let push!: (c: Check[]) => void;
  const run = (onUpdate: (c: Check[]) => void) => { push = onUpdate; return d.promise; };
  render(<CheckupTab run={run} projectId="p1" now={now} />);
  act(() => push([ck('a', 'running'), ck('b', 'running')]));
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.queryByText(/Checked/)).toBeNull();
  const final = [ck('a', 'fail'), ck('b', 'warn'), ck('c', 'ok')];
  await act(async () => { push(final); d.resolve(final); });
  expect(screen.getByText('1 failed, 1 warning, 1 passed')).toBeInTheDocument();
  expect(screen.getByText('Checked 14:02')).toBeInTheDocument();
});

test('groups render in order with labels; empty groups are skipped; heading shows the worst mark', async () => {
  const list = [ck('m', 'ok', { group: 'housekeeping' }), ck('p', 'fail', { group: 'critical' }), ck('p2', 'ok', { group: 'critical' }), ck('g', 'ok', { group: 'connections' })];
  render(<CheckupTab run={instant(list)} projectId="p1" now={now} />);
  const heads = await screen.findAllByRole('heading', { level: 3 });
  expect(heads).toHaveLength(3);
  ['Critical number', 'Connections', 'Housekeeping'].forEach((label, i) => expect(heads[i]).toHaveTextContent(label));
  expect(heads[0]).toHaveTextContent('✗');
  expect(screen.queryByRole('heading', { name: /Contexts/ })).toBeNull();
});

test('context checks render inside a group named after the context', async () => {
  const list = [ck('x', 'ok', { group: 'contexts', context: { id: 'c1', name: 'Sales' } }), ck('y', 'ok', { group: 'contexts' })];
  render(<CheckupTab run={instant(list)} projectId="p1" now={now} />);
  const group = await screen.findByRole('group', { name: 'Sales' });
  expect(within(group).getByText('x')).toBeInTheDocument();
  expect(within(group).queryByText('y')).toBeNull();
});

test('owox fix on a failed check opens the page; ok check shows no button', async () => {
  const onOpen = vi.fn();
  const fix = { kind: 'owox' as const, label: 'Plugins', path: '/ui/p/plugins' };
  render(<CheckupTab run={instant([ck('a', 'fail', { fix }), ck('b', 'ok', { fix })])} projectId="p1" now={now} onOpen={onOpen} />);
  const btn = await screen.findByRole('button', { name: 'Plugins' });
  fireEvent.click(btn);
  expect(onOpen).toHaveBeenCalledWith('/ui/p/plugins');
  expect(screen.getAllByRole('button', { name: 'Plugins' })).toHaveLength(1);
});

test('a warning naming several Data Marts links each of them', async () => {
  const onOpen = vi.fn();
  const fix = [{ kind: 'owox' as const, label: 'Open Orders', path: '/ui/p/data-marts/o/data-setup' }, { kind: 'owox' as const, label: 'Open Sessions', path: '/ui/p/data-marts/s/data-setup' }];
  render(<CheckupTab run={instant([ck('a', 'warn', { fix })])} projectId="p1" now={now} onOpen={onOpen} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open Sessions' }));
  expect(onOpen).toHaveBeenCalledWith('/ui/p/data-marts/s/data-setup');
  expect(screen.getByRole('button', { name: 'Open Orders' })).toBeInTheDocument();
});

test('tab fix goes to the Metrics tab', async () => {
  const onOpenTab = vi.fn();
  render(<CheckupTab run={instant([ck('a', 'warn', { group: 'core', fix: { kind: 'tab', label: 'Open Metrics', tab: 'ontology' } })])} projectId="p1" now={now} onOpenTab={onOpenTab} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open Metrics' }));
  expect(onOpenTab).toHaveBeenCalledWith('ontology');
});

test('snippet fix copies the Metrics table and shows it', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(<CheckupTab run={instant([ck('a', 'fail', { fix: { kind: 'snippet', label: 'Copy snippet' } })])} projectId="p1" now={now} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Copy snippet' }));
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('| Critical number |'));
  expect(screen.getByText(/\| Critical number \|/)).toBeInTheDocument();
});

test('a stale run that resolves late is ignored', async () => {
  const first = deferred();
  const second = deferred();
  const runs = [first, second];
  let i = 0;
  render(<CheckupTab run={() => runs[i++]!.promise} projectId="p1" now={now} />);
  fireEvent.click(screen.getByRole('button', { name: 'Run checks again' }));
  await act(async () => { second.resolve([ck('good', 'ok')]); });
  await act(async () => { first.resolve([ck('bad', 'fail')]); });
  expect(screen.getByText('good')).toBeInTheDocument();
  expect(screen.queryByText('bad')).toBeNull();
});

test('the refresh icon spins while running only', async () => {
  const d = deferred();
  render(<CheckupTab run={() => d.promise} projectId="p1" now={now} />);
  const icon = () => screen.getByRole('button', { name: 'Run checks again' }).querySelector('svg')!;
  expect(icon()).toHaveClass('gy-spin');
  await act(async () => { d.resolve([ck('a', 'ok')]); });
  expect(icon()).not.toHaveClass('gy-spin');
});

const inCtx = (id: string, status: Check['status']) => ck(id, status, { group: 'contexts', context: { id: 'c1', name: 'Finance' } });

test('an all-ok context starts folded with a passed mark; its checks are hidden', async () => {
  render(<CheckupTab run={instant([inCtx('a', 'ok'), inCtx('b', 'ok')])} projectId="p1" now={now} />);
  const group = await screen.findByRole('group', { name: 'Finance' });
  expect(within(group).getByRole('button', { name: 'Finance', expanded: false })).toHaveAttribute('aria-expanded', 'false');
  const head = group.querySelector<HTMLElement>('.dm-collapsible-header')!;
  expect(within(head).getByText('✓')).toBeInTheDocument();
  expect(head).toHaveTextContent('passed');
  expect(within(group).queryByRole('listitem')).toBeNull();
});

test('a context with a failure starts open with the failed mark; the chevron toggles it', async () => {
  render(<CheckupTab run={instant([inCtx('a', 'ok'), inCtx('b', 'fail')])} projectId="p1" now={now} />);
  const group = await screen.findByRole('group', { name: 'Finance' });
  expect(within(group.querySelector<HTMLElement>('.dm-collapsible-header')!).getByText('✗')).toBeInTheDocument();
  expect(within(group).getAllByRole('listitem')).toHaveLength(2);
  fireEvent.click(within(group).getByRole('button', { name: 'Finance', expanded: true }));
  expect(within(group).queryByRole('listitem')).toBeNull();
  fireEvent.click(within(group).getByRole('button', { name: 'Finance', expanded: false }));
  expect(within(group).getAllByRole('listitem')).toHaveLength(2);
});

test('the fold follows the results as a run streams', async () => {
  let push!: (c: Check[]) => void;
  const d = deferred();
  render(<CheckupTab run={(onUpdate) => { push = onUpdate; return d.promise; }} projectId="p1" now={now} />);
  const other = (id: string, status: Check['status']) => ck(id, status, { group: 'contexts', context: { id: 'c2', name: 'Ads' } });
  act(() => push([inCtx('a', 'running'), other('x', 'running')]));
  const fin = screen.getByRole('group', { name: 'Finance' }), ads = screen.getByRole('group', { name: 'Ads' });
  expect(within(fin).getAllByRole('listitem')).toHaveLength(1);
  expect(within(ads).getAllByRole('listitem')).toHaveLength(1);
  // the member folds Ads mid-run; a failure then opens it again
  fireEvent.click(within(ads).getByRole('button', { name: 'Ads' }));
  expect(within(ads).queryByRole('listitem')).toBeNull();
  act(() => push([inCtx('a', 'ok'), other('x', 'fail')]));
  expect(within(fin).queryByRole('listitem')).toBeNull();
  expect(within(ads).getAllByRole('listitem')).toHaveLength(1);
});

test('a recommendation is counted in the summary and marked with a light bulb', async () => {
  render(<CheckupTab run={instant([ck('a', 'recommend'), ck('b', 'recommend'), ck('c', 'ok')])} projectId="p1" now={now} />);
  expect(await screen.findByText('2 recommendations, 1 passed')).toBeInTheDocument();
  expect(screen.getAllByText('💡').length).toBeGreaterThan(0);
});

const suggestion = (over: Partial<Suggestion> = {}): Suggestion => ({
  question: 'Which classes are core?',
  options: [{ label: 'Orders', value: 'o', recommended: true }, { label: 'Customers', value: 'c', recommended: false }],
  ai: false,
  target: (o) => ({ kind: 'settings', patch: { coreClasses: [{ martId: String(o.value), why: '' }] } }),
  ...over,
});
const core = (id: string, status: Check['status'], over: Partial<Check> = {}) => ck(id, status, { group: 'core', ...over });

test('sections show the worst status and a count; every check has an (i) tooltip', async () => {
  render(<CheckupTab run={instant([core('core.set', 'warn'), core('project.fact', 'ok'), core('core.linked', 'recommend')])} projectId="p1" now={now} />);
  const head = await screen.findByRole('heading', { name: /Core classes.*1 warning, 1 recommendation/ });
  expect(head).toHaveTextContent('!');
  expect(screen.getAllByRole('button', { name: /^About / })).toHaveLength(3);
  expect(screen.getByRole('button', { name: 'About core.set' })).toBeInTheDocument();
});

test('a section with only passed checks says All passed and starts folded', async () => {
  render(<CheckupTab run={instant([core('a', 'ok'), core('b', 'skip')])} projectId="p1" now={now} />);
  expect(await screen.findByRole('heading', { name: /Core classes.*All passed/ })).toBeInTheDocument();
  await screen.findByText(/Checked/);
  await act(async () => {});
  expect(screen.getByRole('button', { name: 'Core classes' })).toHaveAttribute('aria-expanded', 'false');
});

test('a section with a recommendation only starts folded; with no model every section is open', async () => {
  const list = [core('a', 'recommend')];
  const a = render(<CheckupTab run={instant(list)} projectId="p1" now={now} />);
  await screen.findByText(/Checked/);
  await act(async () => {});
  expect(screen.getByRole('button', { name: 'Core classes' })).toHaveAttribute('aria-expanded', 'false');
  a.unmount();
  render(<CheckupTab run={instant(list)} projectId="p1" now={now} noModel />);
  await screen.findByText(/Checked/);
  await act(async () => {});
  expect(await screen.findByRole('button', { name: 'Core classes' })).toHaveAttribute('aria-expanded', 'true');
});

test('an admin applies the recommended answer in one click, then the checkup reruns', async () => {
  const apply = vi.fn().mockResolvedValue({ ok: true });
  const run = vi.fn(instant([core('core.set', 'warn', { suggestion: suggestion() })]));
  render(<CheckupTab run={run} projectId="p1" now={now} isAdmin apply={apply} />);
  expect(await screen.findByText('Which classes are core?')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Orders/ })).toBeChecked();
  expect(screen.getByText('Recommended')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  expect(apply).toHaveBeenCalledWith({ kind: 'settings', patch: { coreClasses: [{ martId: 'o', why: '' }] } });
});

test('Apply applies the option the admin picked', async () => {
  const apply = vi.fn().mockResolvedValue({ ok: true });
  render(<CheckupTab run={instant([core('core.set', 'warn', { suggestion: suggestion() })])} projectId="p1" now={now} isAdmin apply={apply} />);
  fireEvent.click(await screen.findByRole('radio', { name: /Customers/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(apply).toHaveBeenCalledWith({ kind: 'settings', patch: { coreClasses: [{ martId: 'c', why: '' }] } }));
});

test('a member sees the question and the recommended answer read-only', async () => {
  const apply = vi.fn();
  render(<CheckupTab run={instant([core('core.set', 'warn', { suggestion: suggestion() })])} projectId="p1" now={now} isAdmin={false} apply={apply} />);
  expect(await screen.findByText('Ask a project admin')).toBeInTheDocument();
  expect(screen.getByText('Which classes are core?')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Orders/ })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Suggest an answer' })).toBeNull();
});

test('a refused write shows the snippet with Copy and keeps the Fix link', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const apply = vi.fn().mockResolvedValue({ ok: false, refused: true, snippet: 'PASTE ME' });
  const fix = { kind: 'owox' as const, label: 'Open settings', path: '/ui/p/x' };
  render(<CheckupTab run={instant([core('core.set', 'warn', { fix, suggestion: suggestion() })])} projectId="p1" now={now} isAdmin apply={apply} onOpen={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));
  const pre = await screen.findByText('PASTE ME');
  expect(pre.tagName).toBe('PRE');
  expect(pre).toHaveClass('gy-snippet');
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  expect(writeText).toHaveBeenCalledWith('PASTE ME');
  expect(screen.getByRole('button', { name: 'Open settings' })).toBeInTheDocument();
});

test('a failed write shows the message under the button', async () => {
  const apply = vi.fn().mockResolvedValue({ ok: false, refused: false, error: 'Server said no' });
  render(<CheckupTab run={instant([core('core.set', 'warn', { suggestion: suggestion() })])} projectId="p1" now={now} isAdmin apply={apply} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Server said no');
});

const aiCheck = () => core('core.industry', 'warn', { suggestion: { question: 'Which business model is closest?', options: [], ai: true, target: () => ({ kind: 'settings', patch: {} }) } });

test('the AI suggestion is fetched once, only when asked', async () => {
  const suggestAi = vi.fn().mockResolvedValue(suggestion({ ai: true, question: 'Which business model is closest?' }));
  render(<CheckupTab run={instant([aiCheck()])} projectId="p1" now={now} isAdmin apply={vi.fn()} suggestAi={suggestAi} />);
  const btn = await screen.findByRole('button', { name: 'Suggest an answer' });
  expect(suggestAi).not.toHaveBeenCalled();
  fireEvent.click(btn);
  await screen.findByRole('radio', { name: /Orders/ });
  expect(screen.queryByRole('button', { name: 'Suggest an answer' })).toBeNull();
  expect(suggestAi).toHaveBeenCalledTimes(1);
  expect(suggestAi).toHaveBeenCalledWith('core.industry');
});

test('the AI suggestion is cached across reruns', async () => {
  const suggestAi = vi.fn().mockResolvedValue(suggestion({ ai: true }));
  render(<CheckupTab run={instant([aiCheck()])} projectId="p1" now={now} isAdmin apply={vi.fn()} suggestAi={suggestAi} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Suggest an answer' }));
  await screen.findByRole('radio', { name: /Orders/ });
  fireEvent.click(screen.getByRole('button', { name: 'Run checks again' }));
  await screen.findByRole('radio', { name: /Orders/ });
  expect(suggestAi).toHaveBeenCalledTimes(1);
});

test('an AI suggestion that comes back empty says so', async () => {
  const suggestAi = vi.fn().mockResolvedValue(null);
  render(<CheckupTab run={instant([aiCheck()])} projectId="p1" now={now} isAdmin apply={vi.fn()} suggestAi={suggestAi} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Suggest an answer' }));
  expect(await screen.findByText(/Couldn't suggest an answer/)).toBeInTheDocument();
});

test('an admin without an AI credential sees the question and a hint, no button', async () => {
  render(<CheckupTab run={instant([aiCheck()])} projectId="p1" now={now} isAdmin apply={vi.fn()} />);
  expect(await screen.findByText('Which business model is closest?')).toBeInTheDocument();
  expect(screen.getByText('Map an AI credential to get a suggested answer')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Suggest an answer' })).toBeNull();
});

test('a member sees an AI question with Ask a project admin', async () => {
  render(<CheckupTab run={instant([aiCheck()])} projectId="p1" now={now} isAdmin={false} />);
  expect(await screen.findByText('Which business model is closest?')).toBeInTheDocument();
  expect(screen.getByText('Ask a project admin')).toBeInTheDocument();
});

test('applying a rebuild goes to the Metrics tab; a refused one stays', async () => {
  const apply = vi.fn().mockResolvedValueOnce({ ok: false, refused: false, error: 'Map an AI credential to rebuild' }).mockResolvedValue({ ok: true });
  const onOpenTab = vi.fn();
  const sug = suggestion({ target: () => ({ kind: 'model', action: 'rebuild' }) });
  render(<CheckupTab run={instant([core('model.fresh', 'warn', { suggestion: sug })])} projectId="p1" now={now} isAdmin apply={apply} onOpenTab={onOpenTab} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));
  await screen.findByRole('alert');
  expect(onOpenTab).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(onOpenTab).toHaveBeenCalledWith('ontology'));
});

test('a core-list Apply waits while the Metrics editor has unsaved edits', async () => {
  const apply = vi.fn().mockResolvedValue({ ok: true });
  render(<CheckupTab run={instant([core('core.set', 'warn', { suggestion: suggestion() })])} projectId="p1" now={now} isAdmin apply={apply} metricsDirty />);
  expect(await screen.findByRole('button', { name: 'Apply' })).toBeDisabled();
  expect(screen.getByText('Save or discard your Metrics edits first')).toBeInTheDocument();
});

test('a clean editor does not hold Apply', async () => {
  render(<CheckupTab run={instant([core('core.set', 'warn', { suggestion: suggestion() })])} projectId="p1" now={now} isAdmin apply={vi.fn()} />);
  expect(await screen.findByRole('button', { name: 'Apply' })).toBeEnabled();
});

test('an AI ask that comes back empty can be tried again', async () => {
  const suggestAi = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(suggestion({ ai: true }));
  render(<CheckupTab run={instant([aiCheck()])} projectId="p1" now={now} isAdmin apply={vi.fn()} suggestAi={suggestAi} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Suggest an answer' }));
  await screen.findByText(/Couldn't suggest an answer/);
  fireEvent.click(screen.getByRole('button', { name: 'Suggest an answer' }));
  await screen.findByRole('radio', { name: /Orders/ });
  expect(suggestAi).toHaveBeenCalledTimes(2);
});

test('a section where everything is skipped says Skipped', async () => {
  render(<CheckupTab run={instant([core('a', 'skip'), core('b', 'skip')])} projectId="p1" now={now} />);
  expect(await screen.findByRole('heading', { name: /Core classes.*Skipped/ })).toBeInTheDocument();
});

test('the heading keeps a status word for screen readers', async () => {
  render(<CheckupTab run={instant([core('a', 'fail'), core('b', 'ok')])} projectId="p1" now={now} />);
  expect(await screen.findByRole('heading', { name: /Core classes.*blocker/ })).toBeInTheDocument();
});
