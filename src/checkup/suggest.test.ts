import { expect, test } from 'vitest';
import { codeSuggestion } from './suggest';
import { ctxWith, detail, f, node, O, C, L, PL } from './suggestFixture';
import type { ProjectSettings } from '../types';

test('core suggestion is sized by industry and recommends the top-ranked', () => {
  const nodes = Array.from({ length: 8 }, (_, i) => node(detail(`m${i}`, `T${i}`, [f('id', 'STRING', { isPrimaryKey: true })])));
  const g = node(detail('g', 'Goal', [f('id', 'STRING', { isPrimaryKey: true })]));
  const edges = nodes.flatMap((n) => [{ from: 'g', to: n.id }, { from: 'x', to: n.id }]);
  const s = codeSuggestion('core.set', ctxWith({ industry: 'media' }, { nodes: [g, ...nodes], edges, goalId: 'g' }))!;
  expect(s.options.filter((o) => o.recommended)).toHaveLength(1);
  expect((s.target(s.options[0]!) as { patch: ProjectSettings }).patch.coreClasses).toHaveLength(4);
  expect(s.options.length).toBeLessThanOrEqual(4);
});

test('the critical number suggestion prefers a revenue field in a dated Data Mart with a key', () => {
  const s = codeSuggestion('project.fact', ctxWith())!;
  expect(s.question).toBe('Which number tells you the business is on track?');
  expect(s.options[0]!.label).toBe('Revenue (Orders)');
  expect(s.options[0]!.recommended).toBe(true);
  // Marketing leads has sales but no key; refund_amount is a STRING
  expect(s.options.map((o) => o.label)).toEqual(['Revenue (Orders)']);
  const t = s.target(s.options[0]!);
  expect(t).toMatchObject({ kind: 'description', mode: 'metrics_table' });
  expect((t as { text: string }).text).toContain(`[Revenue](https://app.owox.com/ui/p/data-marts/${O}/data-setup?field=revenue)`);
  expect(codeSuggestion('project.table', ctxWith())).not.toBeNull();
  expect(codeSuggestion('project.critical', ctxWith())).not.toBeNull();
});

test('the plan suggestion offers plan-like fields and No plan yet', () => {
  const s = codeSuggestion('project.plan', ctxWith())!;
  expect(s.question).toBe('Where is the plan for Revenue?');
  expect(s.options.map((o) => o.label)).toEqual(['revenue_plan (Plan)', 'target (Plan)', 'No plan yet']);
  expect(s.target(s.options[2]!)).toEqual({ kind: 'settings', patch: {} });
  const t = s.target(s.options[0]!) as { kind: string; text: string };
  expect(t.kind).toBe('description');
  expect(t.text).toContain(`data-marts/${PL}/data-setup?field=revenue_plan`);
});

test('contexts are suggested by industry, skipping ones that exist', () => {
  const s = codeSuggestion('contexts.exist', ctxWith({ industry: 'saas' }))!;
  expect(s.question).toBe('Which teams move Revenue?');
  expect(s.options.map((o) => o.label)).toEqual(['Sales', 'Customer success']);
  expect(s.options[0]!.recommended).toBe(true);
  expect(s.target(s.options[0]!)).toEqual({ kind: 'context_create', name: 'Sales', description: '' });
});

test('a context gets the Data Marts whose title shares a word with its name', () => {
  const s = codeSuggestion('context:k1.marts', ctxWith())!;
  expect(s.options.map((o) => o.label)).toEqual(['Marketing leads']);
  expect(s.target(s.options[0]!)).toEqual({ kind: 'mart_contexts', martId: L, contextIds: ['k1'] });
});

test('core.missing offers the dictionary Data Marts to add', () => {
  const s = codeSuggestion('core.missing', ctxWith({ coreClasses: [{ martId: O, why: '' }] }, { edges: [{ from: O, to: C }, { from: PL, to: C }, { from: L, to: C }] }))!;
  expect(s.options[0]!.label).toBe('Customers (3 inbound)');
  expect((s.target(s.options[0]!) as { patch: ProjectSettings }).patch.coreClasses!.map((c) => c.martId)).toEqual([O, C]);
});

test('unknown checks have no code suggestion', () => {
  expect(codeSuggestion('goal.pk', ctxWith())).toBeNull();
  expect(codeSuggestion('project.description', ctxWith())).toBeNull();
});
