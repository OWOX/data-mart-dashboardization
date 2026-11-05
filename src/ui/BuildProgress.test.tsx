import { render, screen } from '../test-host';
import { BuildProgress } from './BuildProgress';
import type { BuildStep, CheckId, CheckState } from '../model/build';

const steps: BuildStep[] = [
  { kind: 'read', what: 'project', done: 1, total: 1, finished: true },
  { kind: 'read', what: 'contexts', done: 2, total: 2, finished: true },
  { kind: 'read', what: 'marts', done: 3, total: 12, finished: false },
];

const ck = (id: CheckId, state: CheckState, detail?: string): BuildStep => ({ kind: 'check', id, state, detail });
const mark = (el: HTMLElement) => el.closest('li')!.querySelector('.gy-chk-mark')!;

test('every project point renders pending before any step, with its tag', () => {
  render(<BuildProgress steps={[]} />);
  for (const t of ["Project description isn't empty", 'Critical number has a fact', 'Critical number has a plan', 'Forecast available', 'Data Marts read: 0 of …', 'AI read the descriptions', 'Classes found']) {
    expect(screen.getByText(t)).toBeInTheDocument();
    expect(mark(screen.getByText(t))).toBeEmptyDOMElement();
  }
  expect(screen.getAllByText('Required')).toHaveLength(5);
  expect(screen.getAllByText('Optional')).toHaveLength(2);
  expect(screen.getAllByText(', pending')).toHaveLength(7);
});

test('context groups appear after the contexts step, or No contexts', () => {
  const { rerender } = render(<BuildProgress steps={[]} />);
  expect(screen.queryByRole('group')).toBeNull();
  rerender(<BuildProgress steps={[{ kind: 'contexts', list: [{ id: 'a', name: 'Sales' }, { id: 'b', name: 'Ads' }] }]} />);
  expect(screen.getByRole('group', { name: 'Sales' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Ads' })).toBeInTheDocument();
  expect(screen.getAllByText("Description isn't empty")).toHaveLength(2);
  expect(screen.getAllByText('Optional')).toHaveLength(2 + 8);
  rerender(<BuildProgress steps={[{ kind: 'contexts', list: [] }]} />);
  expect(screen.getByText('No contexts')).toBeInTheDocument();
});

test('the marts point counts up and ticks do not reach the live region', () => {
  const read = (done: number): BuildStep => ({ kind: 'read', what: 'marts', done, total: 12, finished: false });
  const { container, rerender } = render(<BuildProgress steps={[ck('marts', 'running'), read(3)]} />);
  expect(screen.getByText('Data Marts read: 3 of 12')).toBeInTheDocument();
  // before the AI step the marts fill the first half: 3 of 12 is 12.5%
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '13');
  const live = () => container.querySelector('section[aria-label="Checklist"] [aria-live]')!.textContent;
  expect(live()).toBe('Data Marts read: in progress');
  rerender(<BuildProgress steps={[ck('marts', 'running'), read(3), read(4)]} />);
  expect(live()).toBe('Data Marts read: in progress');
});

test('an optional missing point shows Not set, a required one shows a red cross and its reason', () => {
  render(<BuildProgress steps={[
    { kind: 'contexts', list: [{ id: 'a', name: 'Sales' }] },
    ck('project.plan', 'missing'),
    ck('project.fact', 'failed', 'The Critical number has no link to a Data Mart field.'),
    ck('project.description', 'missing', 'The project description is empty.'),
    ck('context:a.fact', 'done'),
    ck('context:a.plan', 'missing'),
  ]} />);
  expect(screen.getAllByText('Not set')).toHaveLength(2);
  expect(mark(screen.getAllByText('Critical number has a fact')[0]!)).toHaveTextContent('✗');
  expect(mark(screen.getByText("Project description isn't empty"))).toHaveTextContent('✗');
  expect(screen.getByText('The Critical number has no link to a Data Mart field.')).toBeInTheDocument();
  expect(screen.getByText('The project description is empty.')).toBeInTheDocument();
  expect(mark(screen.getAllByText('Critical number has a plan')[0]!)).toHaveTextContent('–');
  expect(screen.getAllByText(', failed')).toHaveLength(2);
  expect(screen.getAllByText(', not set')).toHaveLength(2);
  });

test('a done point shows a tick and says done', () => {
  render(<BuildProgress steps={[ck('project.description', 'done'), ck('project.forecast', 'done', 'Extrapolated from the fact')]} />);
  expect(mark(screen.getByText("Project description isn't empty"))).toHaveTextContent('✓');
  expect(screen.getAllByText(', done')).toHaveLength(2);
});

test('the line is indeterminate before the marts total is known', () => {
  render(<BuildProgress steps={[{ kind: 'read', what: 'project', done: 0, total: null, finished: false }]} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('data-determinate', 'false');
});

test('found rows list the goal, the first three classes and the metric count', () => {
  render(<BuildProgress steps={[...steps, { kind: 'found', goal: 'ARR (Subscriptions)', classes: ['A', 'B', 'C', 'D'], metrics: 7 }]} />);
  expect(screen.getByText('Goal: ARR (Subscriptions)')).toBeInTheDocument();
  expect(screen.getByText('Classes: 4 (A, B, C, …)')).toBeInTheDocument();
  expect(screen.getByText('Metrics: 7')).toBeInTheDocument();
});

test('a goal-only found step shows no classes or metrics rows', () => {
  render(<BuildProgress steps={[...steps, { kind: 'found', goal: 'ARR (Subscriptions)', classes: [], metrics: 0 }]} />);
  expect(screen.getByText('Goal: ARR (Subscriptions)')).toBeInTheDocument();
  expect(screen.queryByText(/^Classes:/)).toBeNull();
  expect(screen.queryByText(/^Metrics:/)).toBeNull();
});

test('the line is indeterminate while the AI reads, and the row flips when it finishes', () => {
  const m: BuildStep = { kind: 'read', what: 'marts', done: 12, total: 12, finished: true };
  const { rerender } = render(<BuildProgress steps={[m, { kind: 'read', what: 'ai', done: 0, total: null, finished: false }]} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('data-determinate', 'false');
  rerender(<BuildProgress steps={[m, { kind: 'read', what: 'ai', done: 1, total: 1, finished: true }]} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('data-determinate', 'true');
  expect(screen.getByText('AI read the descriptions')).toBeInTheDocument();
});

test('unreadable contexts say so instead of No contexts, and the Found heading waits for content', () => {
  render(<BuildProgress steps={[{ kind: 'contexts', list: [], failed: true }]} />);
  expect(screen.getByText("Contexts couldn't be read")).toBeInTheDocument();
  expect(screen.queryByText('No contexts')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Found' })).toBeNull();
});

test('a missing optional point shows a dash, distinct from pending', () => {
  render(<BuildProgress steps={[ck('project.plan', 'missing')]} />);
  expect(mark(screen.getByText('Critical number has a plan'))).toHaveTextContent('–');
});
