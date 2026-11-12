import { expect, test } from 'vitest';
import { aiSuggestion, AI_CHECKS, isAiCheck, aiQuestion } from './suggestAi';
import { ctxWith } from './suggestFixture';

test('an industry suggestion preselects the AI answer and offers every industry', async () => {
  const s = (await aiSuggestion('core.industry', ctxWith(), async () => ({ industry: 'saas' })))!;
  expect(s.options).toHaveLength(8);
  expect(s.options.find((o) => o.recommended)!.value).toBe('saas');
  expect(s.target(s.options.find((o) => o.recommended)!)).toEqual({ kind: 'settings', patch: { industry: 'saas' } });
});

test('an unreadable or throwing AI answer gives no suggestion', async () => {
  expect(await aiSuggestion('core.industry', ctxWith(), async () => ({ nope: 1 }))).toBeNull();
  expect(await aiSuggestion('core.industry', ctxWith(), async () => { throw new Error('x'); })).toBeNull();
  expect(await aiSuggestion('project.fact', ctxWith(), async () => ({}))).toBeNull();
});

test('description drafts append to the project description', async () => {
  const s = (await aiSuggestion('project.description', ctxWith(), async () => ({ text: 'We sell shoes.' })))!;
  expect(s.question).toBe('What does the business sell, and to whom?');
  expect(s.target(s.options[0]!)).toEqual({ kind: 'description', mode: 'append', text: 'We sell shoes.' });
  const b = (await aiSuggestion('core.business', ctxWith(), async () => ({ text: 'Orders, Customers.' })))!;
  expect(b.question).toBe('What does the business sell, to whom, and through which channels?');
});

test('a context description updates that context', async () => {
  const s = (await aiSuggestion('context:k1.description', ctxWith(), async () => ({ text: 'Owns campaigns.' })))!;
  expect(s.target(s.options[0]!)).toEqual({ kind: 'context_update', id: 'k1', name: 'Marketing', description: 'Owns campaigns.' });
});

test('a context fact offers the AI picks as a Metrics table in the context', async () => {
  const s = (await aiSuggestion('context:k1.fact', ctxWith(), async () => ({ picks: [0] })))!;
  expect(s.question).toBe('Which number shows Marketing is doing its job?');
  const t = s.target(s.options[0]!);
  expect(t).toMatchObject({ kind: 'context_update', id: 'k1' });
  expect((t as { description: string }).description).toContain('data-marts/' + 'aaaaaaaa-0000-0000-0000-000000000001');
  expect(await aiSuggestion('context:k1.fact', ctxWith(), async () => ({ picks: [9] }))).toBeNull();
});

test('AI_CHECKS names the covered ids', () => {
  expect(isAiCheck('context:k1.description')).toBe(true);
  expect(isAiCheck('project.fact')).toBe(false);
  expect(AI_CHECKS.has('core.industry')).toBe(true);
  expect(aiQuestion('core.industry', ctxWith())).toBe('Which business model is closest?');
});
