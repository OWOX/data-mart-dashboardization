import { owox } from '@owox/plugin-sdk';
import type { AggregateFunction, MartField, MartRef, QueryRequest, QueryResult } from './types';

/** List routes wrap their array in different envelopes depending on the route; accept them all. */
function toArray<T>(res: unknown): T[] {
  const r = res as { items?: T[]; data?: T[]; rows?: T[] } | T[] | null | undefined;
  if (Array.isArray(r)) return r;
  return r?.items ?? r?.data ?? r?.rows ?? [];
}

const NUMERIC = /^(INT|FLOAT|NUMERIC|BIGNUMERIC|DECIMAL|DOUBLE|LONG)/i;
const TEMPORAL = /^(DATE|DATETIME|TIMESTAMP|TIME)$/i;

/** Governance defaults, applied only when the mart schema omits them. */
function defaultsFor(type: string): { role: MartField['role']; allowedAggregations: AggregateFunction[] } {
  if (NUMERIC.test(type)) return { role: 'metric', allowedAggregations: ['SUM', 'AVG', 'MIN', 'MAX'] };
  if (TEMPORAL.test(type)) return { role: 'dimension', allowedAggregations: ['MIN', 'MAX'] };
  return { role: 'dimension', allowedAggregations: ['COUNT', 'COUNT_DISTINCT'] };
}

/** Marts a dashboard may be built on. The broker has already filtered to what the user can see. */
export async function listMarts(): Promise<MartRef[]> {
  const res = await owox.request('GET', '/api/data-marts');
  return toArray<{ id: string; title?: string; status?: string; availableForReporting?: boolean }>(res)
    .filter(m => m.status === 'PUBLISHED' && m.availableForReporting)
    .map(m => ({ id: m.id, title: m.title ?? m.id }));
}

export async function getMartFields(id: string): Promise<MartField[]> {
  const res = (await owox.request('GET', `/api/data-marts/${id}`)) as {
    schema?: { fields?: Array<{ name: string; type: string; aggregationRole?: MartField['role']; allowedAggregations?: AggregateFunction[] }> };
  };
  return (res.schema?.fields ?? []).map(f => {
    const d = defaultsFor(f.type);
    return {
      name: f.name,
      type: f.type,
      role: f.aggregationRole ?? d.role,
      allowedAggregations: f.allowedAggregations ?? d.allowedAggregations,
    };
  });
}

/**
 * The ONE data call. Aggregation is entirely server-side: a projected field WITH an aggregation
 * rule is a metric, one WITHOUT is a grouping key. `totals` comes back computed over all matching
 * rows, ignoring `limit` — that is what scorecards read.
 */
export async function queryDataMart(id: string, body: QueryRequest): Promise<QueryResult> {
  return (await owox.request('POST', `/api/data-marts/${id}/query`, body)) as QueryResult;
}
