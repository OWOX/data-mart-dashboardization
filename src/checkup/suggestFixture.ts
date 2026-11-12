import type { SuggestContext } from './suggest';
import type { MartDetail, MartSummary } from '../owox/sources';
import type { MartNode } from '../model/graph';
import type { ProjectSettings } from '../types';

export const O = 'aaaaaaaa-0000-0000-0000-000000000001'; // Orders (goal)
export const C = 'aaaaaaaa-0000-0000-0000-000000000002'; // Customers
export const L = 'aaaaaaaa-0000-0000-0000-000000000003'; // Leads, no key
export const PL = 'aaaaaaaa-0000-0000-0000-000000000004'; // Plan
export const f = (name: string, type: string, extra: object = {}) => ({ name, type, isPrimaryKey: false, ...extra });
export const detail = (id: string, title: string, fields: MartDetail['fields']): MartDetail => ({ id, title, fields });
export const node = (d: MartDetail, contexts: MartNode['contexts'] = []): MartNode => ({ id: d.id, title: d.title, contexts, detail: d, blendable: { availableSources: [], mainUniqueCountKeyFields: [] } });
export const sum = (id: string, title: string) => ({ id, title, status: 'PUBLISHED', description: null, contexts: [], modifiedAt: 'x' }) as MartSummary;

export function ctxWith(settings: Partial<ProjectSettings> = {}, over: Partial<SuggestContext> = {}): SuggestContext {
  const orders = detail(O, 'Orders', [f('id', 'STRING', { isPrimaryKey: true }), f('day', 'DATE'), f('revenue', 'FLOAT', { alias: 'Revenue' }), f('refund_amount', 'STRING'), f('qty', 'INTEGER')]);
  const customers = detail(C, 'Customers', [f('id', 'STRING', { isPrimaryKey: true }), f('signup', 'DATE')]);
  const leads = detail(L, 'Marketing leads', [f('sales', 'FLOAT'), f('day', 'DATE')]);
  const plan = detail(PL, 'Plan', [f('id', 'STRING', { isPrimaryKey: true }), f('day', 'DATE'), f('revenue_plan', 'FLOAT'), f('target', 'INTEGER')]);
  return {
    inputs: {
      projectDescription: '## Metrics\n| Role | Metric | Plan | Fact |\n|---|---|---|---|\n| Critical number | Revenue | | |',
      contexts: [{ id: 'k1', name: 'Marketing', description: null }], contextsOk: true,
      marts: [sum(O, 'Orders'), sum(C, 'Customers'), sum(L, 'Marketing leads'), sum(PL, 'Plan')].map((m) => m.id === L ? { ...m, contexts: [] } : m),
    },
    nodes: [node(orders), node(customers), node(leads), node(plan)],
    edges: [{ from: O, to: C }, { from: PL, to: C }],
    goalId: O, projectId: 'p',
    settings: { thresholdPct: 20, industry: null, coreClasses: null, ...settings },
    ...over,
  };
}

