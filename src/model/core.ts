import type { ClassNode, CoreClass, Edge, Industry, Model } from '../types';
import { primaryKeyPaths } from './graph';
import type { MartDetail } from '../owox/sources';

const MIN_CORE = 3;
const MAX_CORE = 7;

export const INDUSTRIES: { id: Industry; label: string; count: number; typical: string[] }[] = [
  { id: 'ecommerce', label: 'E-commerce, retail', count: 5, typical: ['Customers', 'Products', 'Sessions or Visitors', 'Campaigns', 'Stores or Channels'] },
  { id: 'saas', label: 'SaaS, subscriptions', count: 5, typical: ['Accounts', 'Users', 'Plans', 'Subscriptions', 'Campaigns'] },
  { id: 'marketplace', label: 'Marketplace', count: 6, typical: ['Buyers', 'Sellers', 'Listings', 'Categories', 'Sessions', 'Campaigns'] },
  { id: 'media', label: 'Media, content', count: 4, typical: ['Users', 'Content items', 'Sessions', 'Advertisers'] },
  { id: 'b2b', label: 'B2B services, agency', count: 4, typical: ['Clients', 'Contracts', 'Projects', 'Employees'] },
  { id: 'apps', label: 'Mobile apps, games', count: 4, typical: ['Users', 'Installs', 'Devices', 'Campaigns'] },
  { id: 'finance', label: 'Finance, lending', count: 5, typical: ['Customers', 'Accounts', 'Products', 'Applications', 'Channels'] },
  { id: 'other', label: 'Other', count: 3, typical: ['The top 3 candidates by inbound references'] },
];

/** Exactly one primary key path. */
export const singleKey = (detail: MartDetail): boolean => primaryKeyPaths(detail.fields).length === 1;

/** Distinct Data Marts whose calculated fields reference each target. */
export function inboundCounts(edges: Edge[]): Map<string, number> {
  const from = new Map<string, Set<string>>();
  for (const e of edges) from.set(e.to, (from.get(e.to) ?? new Set()).add(e.from));
  return new Map([...from].map(([to, s]) => [to, s.size]));
}

/** Candidates ranked for core: single-column primary key, not the goal, directly connected to the goal, inbound > 0. */
export function rankCore(args: { goalId: string; nodes: { id: string; title: string; singleKey: boolean }[]; edges: Edge[] }): string[] {
  const { goalId, nodes, edges } = args;
  const inbound = inboundCounts(edges);
  const connected = (id: string) => edges.some((e) => (e.from === goalId && e.to === id) || (e.from === id && e.to === goalId));
  const cands = nodes.filter((n) => n.singleKey && n.id !== goalId && connected(n.id) && (inbound.get(n.id) ?? 0) > 0);
  const ids = new Set(cands.map((n) => n.id));
  const links = (id: string) => new Set(edges.flatMap((e) => (e.from === id && ids.has(e.to) ? [e.to] : e.to === id && ids.has(e.from) ? [e.from] : []))).size;
  return cands
    .sort((a, b) => (inbound.get(b.id) ?? 0) - (inbound.get(a.id) ?? 0) || links(b.id) - links(a.id) || a.title.localeCompare(b.title))
    .map((n) => n.id);
}

/** Existing core classes stay; new picks are added in order until 7. A first list under 3 is topped up from the ranking; null existing with no picks: the ranked top `count`. */
export function mergeCore(existing: CoreClass[] | null, picks: CoreClass[], ranked: string[], count: number): CoreClass[] {
  if (existing === null && !picks.length) return ranked.slice(0, Math.min(count, MAX_CORE)).map((martId) => ({ martId, why: '' }));
  const out = [...(existing ?? [])];
  for (const p of picks) if (out.length < MAX_CORE && !out.some((c) => c.martId === p.martId)) out.push(p);
  if (existing === null) for (const martId of ranked) if (out.length < MIN_CORE && !out.some((c) => c.martId === martId)) out.push({ martId, why: '' });
  return out;
}

/** Sets core and inbound on the model's classes from the list; classes not in the model are ignored. */
export function applyCore(model: Model, core: CoreClass[], inbound: ReadonlyMap<string, number>): Model {
  const marts = new Set(core.map((c) => c.martId));
  return { ...model, classes: model.classes.map((c): ClassNode => ({ ...c, core: marts.has(c.martId), inbound: inbound.get(c.id) ?? 0 })) };
}
