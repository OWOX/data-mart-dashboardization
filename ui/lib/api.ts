import { pluginClient } from './plugin-client';
import type { AggregateFunction, MartField, MartRef, QueryRequest, QueryResult } from './types';
import {
  rowsToQueryResult, needsGrandTotal, shouldKeepPolling,
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
  const marts = await pluginClient.list();
  return marts
    .filter(m => m.status === 'PUBLISHED' && m.availableForReporting)
    .map(m => ({ id: String(m.id), title: m.title ?? String(m.id) }));
}

/**
 * A mart's fields, from its declared schema.
 *
 * The schema carries governance nothing else does — `aggregationRole`, `allowedAggregations`,
 * `isHiddenForReporting` — and reaches the plugin through the SDK's escape hatch (see
 * `pluginClient.getById`), whose response is unvalidated by contract, hence the defensive reads
 * below rather than trust in the type parameter.
 */
export async function getMartFields(id: string): Promise<MartField[]> {
  const mart = (await pluginClient.getById(id)) as {
    schema?: { fields?: Array<{ name: string; type: string; aggregationRole?: MartField['role']; allowedAggregations?: AggregateFunction[]; isHiddenForReporting?: boolean; isPrimaryKey?: boolean; alias?: string }> };
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
      ...(f.isPrimaryKey ? { isPrimaryKey: true } : {}),
      ...(f.alias ? { alias: f.alias } : {}),
    };
  });
}

/**
 * Every field a dashboard may build on: the mart's own, plus the columns each joined source
 * contributes. The joined half is what the host's own column picker shows (668 fields over 61
 * sources on a large mart), so it is loaded separately from `getMartFields` — the generator works
 * from native fields only, while the Fields panel offers everything.
 *
 * Governance comes from `postJoinAggregations`, which is the joined field's own allow-list; a field
 * that can be summed or averaged is a metric, anything else is a dimension. Sources the host marks
 * as not included or not reportable are dropped, mirroring `visibleBlendedColumnNames` server-side —
 * projecting one of those columns is rejected by the reporting endpoint.
 *
 * Joined `<alias>__unique_count` pseudo-columns are deliberately NOT offered: they exist in the
 * report/MCP surface but not in the blendable column set this endpoint publishes, so requesting one
 * answers 400 Unknown column.
 */
export async function getAllFields(id: string): Promise<MartField[]> {
  const native = await getMartFields(id);
  let blended: MartField[] = [];
  try {
    blended = await joinedFields(id);
  } catch (error) {
    // A mart with no relationships, or an older deployment: the mart's own fields still work.
    console.warn(`[dashboards] no blendable schema for Data Mart ${id}`, error);
  }
  return [...native, ...blended];
}

async function joinedFields(id: string): Promise<MartField[]> {
  const schema = (await pluginClient.getBlendableSchema(id)) as {
    blendedFields?: Array<{
      name: string; type: string; alias?: string; isHidden?: boolean; aliasPath?: string;
      sourceDataMartTitle?: string; postJoinAggregations?: AggregateFunction[];
    }>;
    availableSources?: Array<{
      aliasPath?: string; title?: string; isIncluded?: boolean; isAccessibleForReporting?: boolean;
    }>;
  };
  const usable = new Set(
    (schema.availableSources ?? [])
      .filter(s => s.isIncluded && s.isAccessibleForReporting && s.aliasPath)
      .map(s => s.aliasPath as string),
  );
  const titles = new Map(
    (schema.availableSources ?? []).map(s => [s.aliasPath ?? '', s.title ?? s.aliasPath ?? '']),
  );

  return (schema.blendedFields ?? [])
    .filter(f => !f.isHidden && f.aliasPath && usable.has(f.aliasPath))
    .map(f => {
      const allowed = f.postJoinAggregations ?? [];
      const aggregatable = allowed.includes('SUM') || allowed.includes('AVG');
      const d = defaultsFor(f.type);
      return {
        name: f.name,
        type: f.type,
        role: (aggregatable ? 'metric' : 'dimension') as MartField['role'],
        allowedAggregations: allowed.length > 0 ? allowed : d.allowedAggregations,
        ...(f.alias ? { alias: f.alias } : {}),
        source: {
          aliasPath: f.aliasPath as string,
          title: titles.get(f.aliasPath as string) ?? (f.sourceDataMartTitle ?? 'Joined'),
        },
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
 * Read the scorecard number from the RUN, per AGENTS.md — the grand totals are a SEPARATE async DWH
 * query, keyed by `"<field> | <FUNCTION>"`, bridged via the run's id (`traverseData(...).runId`).
 * Poll `getRun` until it carries totals or reaches a terminal status. Returns null when the run
 * reports none — which is the live reality on backends that don't populate run totals yet (the same
 * best-effort caveat AGENTS.md notes for `.sql`); `queryDataMart` then falls back to the single
 * server-aggregated row (a read, NOT a client-side re-sum — there is nothing to sum, the server
 * already aggregated to one row).
 */
async function fetchRunTotals(id: string, runId: string): Promise<QueryResult['totals']> {
  for (let i = 0; i < TOTALS_POLL_TRIES; i++) {
    let run: { status: string; totals: QueryResult['totals'] };
    try { run = await pluginClient.getRun(id, runId); }
    catch { return null; }
    if (run.totals) return run.totals;
    if (!shouldKeepPolling(run.status)) return null;
    await sleep(TOTALS_POLL_DELAY_MS);
  }
  return null;
}

/** The SQL a run executed, read on demand (see `QueryResult.runId`). Null when the run reports none. */
export async function fetchRunSql(martId: string, runId: string): Promise<string | null> {
  try {
    return (await pluginClient.getRun(martId, runId)).sql;
  } catch {
    return null;
  }
}

/**
 * The ONE data call, via the typed client's `traverseData`. Aggregation is entirely server-side:
 * a projected field WITH an aggregation rule is a metric, one WITHOUT is a grouping key; `sort` and
 * `limit` are applied by the server (ORDER BY before LIMIT). For a scorecard (aggregation, no
 * grouping) the grand total comes STRICTLY from the run via `.runId` → `getRun` (getRunById) — never
 * re-derived from rows client-side. A run that reports no totals yields `null`, and the scorecard
 * renders its empty state.
 */
export async function queryDataMart(id: string, body: QueryRequest): Promise<QueryResult> {
  const askedLimit = body.limit ?? DEFAULT_LIMIT;
  const traversal = await pluginClient.traverseData(id, {
    column: body.fields,
    aggregation: nonEmpty(body.aggregationConfig),
    dateTrunc: nonEmpty(body.dateTruncConfig),
    filter: nonEmpty(body.filterConfig),
    sort: nonEmpty(body.sortConfig),
    limit: askedLimit + 1, // over-read by one to detect truncation
  });
  const objs = await traversal.rows();

  const totals = needsGrandTotal(body) && traversal.runId
    ? await fetchRunTotals(id, traversal.runId)
    : null;
  // The run id travels with the result so "Copy SQL" can fetch on click; no extra request here.
  return { ...rowsToQueryResult(objs, body, askedLimit, totals), runId: traversal.runId ?? null };
}
