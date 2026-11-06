import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { CheckupTab } from './CheckupTab';
import type { Check } from '../checkup/types';

const ck = (id: string, status: Check['status'], over: Partial<Check> = {}): Check => ({ id, group: 'heading', label: id, status, ...over });
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
  const list = [ck('m', 'ok', { group: 'housekeeping' }), ck('p', 'fail', { group: 'heading' }), ck('p2', 'ok', { group: 'heading' }), ck('g', 'ok', { group: 'connections' })];
  render(<CheckupTab run={instant(list)} projectId="p1" now={now} />);
  const heads = await screen.findAllByRole('heading', { level: 3 });
  expect(heads).toHaveLength(3);
  ['Where the business is heading', 'How it connects', 'Housekeeping'].forEach((label, i) => expect(heads[i]).toHaveTextContent(label));
  expect(heads[0]).toHaveTextContent('✗');
  expect(screen.queryByRole('heading', { name: /What drives it/ })).toBeNull();
});

test('context checks render inside a group named after the context', async () => {
  const list = [ck('x', 'ok', { group: 'drivers', context: { id: 'c1', name: 'Sales' } }), ck('y', 'ok', { group: 'drivers' })];
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

test('tab fix opens the tab', async () => {
  const onOpenTab = vi.fn();
  render(<CheckupTab run={instant([ck('a', 'warn', { fix: { kind: 'tab', label: 'Ontology', tab: 'ontology' } })])} projectId="p1" now={now} onOpenTab={onOpenTab} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ontology' }));
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

const inCtx = (id: string, status: Check['status']) => ck(id, status, { group: 'drivers', context: { id: 'c1', name: 'Finance' } });

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
  const other = (id: string, status: Check['status']) => ck(id, status, { group: 'drivers', context: { id: 'c2', name: 'Ads' } });
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
