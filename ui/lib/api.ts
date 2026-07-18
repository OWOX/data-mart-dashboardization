import { owox } from '@owox/plugin-sdk';
import type { AggregateFunction, MartField, MartRef, QueryRequest, QueryResult } from './types';
import {
  rowsToQueryResult, needsGrandTotal, grandTotalFromRow, shouldKeepPolling,
} from './httpData';

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
  const marts = await owox.dataMarts.list();
  return marts
    .filter(m => m.status === 'PUBLISHED' && m.availableForReporting)
    .map(m => ({ id: String(m.id), title: m.title ?? String(m.id) }));
}

export async function getMartFields(id: string): Promise<MartField[]> {
  const mart = (await owox.dataMarts.getById(id)) as {
    schema?: { fields?: Array<{ name: string; type: string; aggregationRole?: MartField['role']; allowedAggregations?: AggregateFunction[]; isHiddenForReporting?: boolean }> };
  };
  // The HTTP Data (reporting) endpoint 400s on any column flagged isHiddenForReporting — e.g. a
  // hidden primary key — so drop them here, at the one boundary fields enter the plugin, or the
  // generator builds components on columns that can never be queried.
  return (mart.schema?.fields ?? []).filter(f => !f.isHiddenForReporting).map(f => {
    const d = defaultsFor(f.type);
    return {
      name: f.name,
      type: f.type,
      role: f.aggregationRole ?? d.role,
      allowedAggregations: f.allowedAggregations ?? d.allowedAggregations,
    };
  });
}

const DEFAULT_LIMIT = 20;
const TOTALS_POLL_TRIES = 6;
const TOTALS_POLL_DELAY_MS = 1200;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Drop empty arrays so traverseData omits the param entirely (an empty `aggregation=` etc. is invalid). */
const nonEmpty = <T>(a: T[] | null | undefined): T[] | undefined => (a && a.length ? a : undefined);

/**
 * The run's grand totals are a SEPARATE async DWH query, bridged via the run's `x-owox-run-id`
 * (`traverseData(...).runId`). Poll the run until it carries totals or reaches a terminal status.
 * Best effort — a scorecard falls back to its single streamed row if this yields nothing.
 */
async function fetchRunTotals(id: string, runId: string): Promise<QueryResult['totals']> {
  for (let i = 0; i < TOTALS_POLL_TRIES; i++) {
    let run: { status: string; totals: QueryResult['totals'] };
    try { run = await owox.dataMarts.getRun(id, runId); }
    catch { return null; }
    if (run.totals) return run.totals;
    if (!shouldKeepPolling(run.status)) return null;
    await sleep(TOTALS_POLL_DELAY_MS);
  }
  return null;
}

/**
 * The ONE data call, via the typed client's `traverseData`. Aggregation is entirely server-side:
 * a projected field WITH an aggregation rule is a metric, one WITHOUT is a grouping key; `sort` and
 * `limit` are applied by the server (ORDER BY before LIMIT). For a scorecard (aggregation, no
 * grouping) we also fetch the run's grand totals via `.runId` — that is what the scorecard reads.
 */
export async function queryDataMart(id: string, body: QueryRequest): Promise<QueryResult> {
  const askedLimit = body.limit ?? DEFAULT_LIMIT;
  const traversal = await owox.dataMarts.traverseData(id, {
    column: body.fields,
    aggregation: nonEmpty(body.aggregationConfig),
    dateTrunc: nonEmpty(body.dateTruncConfig),
    filter: nonEmpty(body.filterConfig),
    sort: nonEmpty(body.sortConfig),
    limit: askedLimit + 1, // over-read by one to detect truncation
  });
  const objs = await traversal.rows();

  let totals: QueryResult['totals'] = null;
  if (needsGrandTotal(body)) {
    if (traversal.runId) totals = await fetchRunTotals(id, traversal.runId);
    if (!totals) totals = grandTotalFromRow(objs.slice(0, askedLimit), body);
  }
  return rowsToQueryResult(objs, body, askedLimit, totals);
}
