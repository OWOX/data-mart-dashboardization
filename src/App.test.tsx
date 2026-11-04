import { fireEvent, render, screen } from '@testing-library/react';
import { App, depsFrom, type AppDeps } from './App';
import { fakeOwox } from './owox/fake';
import { memoryCollections } from './store/collections';

const deps = (generate: AppDeps['generate']): AppDeps => ({
  owox: fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {} }),
  store: memoryCollections(),
  generate,
  userId: 'u1',
  now: () => new Date('2026-10-24T10:00:00Z'),
});

test('first open builds with no click; no goal shows the blocked screen', async () => {
  render(<App ctx={{ projectId: 'p1' } as never} deps={deps(async () => ({ goal: { status: 'missing', metricRef: null, note: '' }, metrics: [] }))} />);
  expect(await screen.findByRole('heading', { name: "Goal can't be tracked" })).toBeInTheDocument();
});

test('without AI the blocked screen shows', async () => {
  render(<App ctx={{ projectId: 'p1' } as never} deps={deps(null)} />);
  expect(await screen.findByRole('heading', { name: 'AI model not configured' })).toBeInTheDocument();
  expect(screen.getByText(/map an AI model/)).toBeInTheDocument();
});

test('a failed build shows an error with Retry, not the blocked screen', async () => {
  const d = deps(async () => ({ goal: { status: 'missing', metricRef: null, note: '' }, metrics: [] }));
  const owox = d.owox;
  let fail = true;
  d.owox = {
    ...owox,
    project: { getSettings: async () => { if (fail) throw new Error('BUILD_FAILED: boom'); return { description: null }; } },
  };
  render(<App ctx={{ projectId: 'p1' } as never} deps={d} />);
  expect(await screen.findByText(/BUILD_FAILED/)).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: "Goal can't be tracked" })).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('heading', { name: "Goal can't be tracked" })).toBeInTheDocument();
});

test('the build uses the Reasoning model, or Fast on installs that declare only fast', () => {
  const generate = (ai: object) => depsFrom({ credentials: { ai }, owox: {}, userId: 'u1' } as never).generate;
  expect(generate({ fast: {}, reasoning: {} })).not.toBeNull();
  expect(generate({ fast: {} })).not.toBeNull();
  expect(generate({})).toBeNull();
  expect(depsFrom({ owox: {}, userId: 'u1' } as never).generate).toBeNull();
});
