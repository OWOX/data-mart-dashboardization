import { fireEvent, render, screen } from '@testing-library/react';
import { App, type AppDeps } from './App';
import { fakeOwox } from './owox/fake';
import { memoryCollections } from './store/collections';

const deps = (generate: AppDeps['generate']): AppDeps => ({
  owox: fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {} }),
  store: memoryCollections(),
  generate,
  userId: 'u1',
  now: () => new Date('2026-10-24T10:00:00Z'),
});

test('first open shows intro; build with no goal shows the blocked screen', async () => {
  render(<App ctx={{ projectId: 'p1' } as never} deps={deps(async () => ({ goal: { status: 'missing', metricRef: null, note: '' }, metrics: [] }))} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Build model' }));
  expect(await screen.findByRole('heading', { name: "Goal can't be tracked" })).toBeInTheDocument();
});

test('without AI the build button is disabled with a reason', async () => {
  render(<App ctx={{ projectId: 'p1' } as never} deps={deps(null)} />);
  expect(await screen.findByRole('button', { name: 'Build model' })).toBeDisabled();
  expect(screen.getByText('Ask a project admin to map an AI model')).toBeInTheDocument();
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
  fireEvent.click(await screen.findByRole('button', { name: 'Build model' }));
  expect(await screen.findByText(/BUILD_FAILED/)).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: "Goal can't be tracked" })).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('heading', { name: "Goal can't be tracked" })).toBeInTheDocument();
});
