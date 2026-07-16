// DEV-ONLY scaffolding for the "Data Mart Dashboards" plugin.
//
// The plugin compiles every dashboard component into ONE server-side aggregated query and calls
// `POST /api/data-marts/:id/query`. That REST endpoint exists in our owox-data-marts branch but is
// NOT deployed on app.owox.com. The same server-side capability IS deployed, through the OWOX
// HTTP Data API, and reached here via the official @owox/api-client:
//
//   client.dataMarts.traverseData(id, { column, filter, sort, aggregation, dateTrunc, limit })
//     -> streams NDJSON rows, and exposes the run id from the `x-owox-run-id` response header.
//   client.getJson(`/api/data-marts/:id/runs/:runId`)
//     -> the run's grand-totals summary (a SEPARATE DWH query, keyed by `<column> | <FN>`),
//        which the scorecard reads.
//
// This shim translates our REST contract to those calls on the API key alone (no OAuth). Everything
// else proxies straight to app.owox.com. Delete this file once `POST /api/data-marts/:id/query`
// ships. It must never be imported by anything under `ui/` — it is a dev-only Node script.

// ---------- pure mapping logic (unit-tested, no network) ----------

/**
 * The HTTP Data API names an aggregated output column `<column> | <TOKEN>` (dots -> `_`), and the
 * run's `totals` object uses the same keys — identical to the plugin's own `aggLabel` and to the
 * backend's aggregation-labels.ts. The plugin reads results back by this key, so it must match.
 */
export const AGG_TOKEN = {
  SUM: 'SUM', AVG: 'AVG', MIN: 'MIN', MAX: 'MAX', COUNT: 'COUNT',
  COUNT_DISTINCT: 'COUNTUNIQUE',
  P25: 'P25', P50: 'MEDIAN', P75: 'P75', P95: 'P95',
};

export function aggLabel(column, fn) {
  return `${column.replace(/\./g, '_')} | ${AGG_TOKEN[fn]}`;
}

const ROW_COUNT_KEY = 'Row Count'; // grouping metadata the endpoint appends; not a plugin column

/** The output column names the plugin expects, in the order it projected them. */
export function expectedColumns(body) {
  const agg = new Map((body.aggregationConfig ?? []).map(a => [a.column, a.function]));
  return (body.fields ?? []).map(f => (agg.has(f) ? aggLabel(f, agg.get(f)) : f));
}

/** A scorecard compiles to an aggregation with no grouping dimension; only then does it read totals. */
export function needsGrandTotal(body) {
  if (!body.aggregationConfig?.length) return false;
  const aggCols = new Set(body.aggregationConfig.map(a => a.column));
  return (body.fields ?? []).every(f => aggCols.has(f));
}

/**
 * Fallback grand total when the run lookup can't deliver one: a no-grouping aggregate stream
 * returns a single row that IS the total. Used only when `needsGrandTotal(body)` and the run's
 * own totals were unavailable.
 */
export function grandTotalFromRow(rowObjects, body) {
  if (!needsGrandTotal(body) || !rowObjects.length) return null;
  const totals = {};
  for (const [k, v] of Object.entries(rowObjects[0])) if (k !== ROW_COUNT_KEY) totals[k] = v;
  return totals;
}

/**
 * NDJSON row objects (from api-client's rowChunks) -> our QueryResult. `askedLimit` is what the
 * PLUGIN requested; we over-read by one, so more rows than that means the result is truncated and
 * we slice back. Row values are already typed (JSON), so no coercion.
 */
export function rowsToQueryResult(rowObjects, body, askedLimit, totals = null) {
  const truncated = askedLimit != null && rowObjects.length > askedLimit;
  const kept = truncated ? rowObjects.slice(0, askedLimit) : rowObjects;
  const columns = kept.length
    ? Object.keys(kept[0]).filter(k => k !== ROW_COUNT_KEY)
    : expectedColumns(body);
  const rows = kept.map(o => columns.map(c => (o[c] ?? null)));
  return { columns, rows, truncated, totals };
}

const NON_TERMINAL_RUN_STATUS = new Set(['PENDING', 'RUNNING']);
/** Keep polling the run only while it is still working. SUCCESS/FAILED/CANCELLED/… are terminal. */
export function shouldKeepPolling(status) {
  return NON_TERMINAL_RUN_STATUS.has(status);
}

// ---------- runtime: @owox/api-client translation proxy ----------

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWOXApiClient } from '@owox/api-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM = 'https://app.owox.com';
const SHIM_PORT = 5300;
const DEFAULT_LIMIT = 20;
const TOTALS_POLL_TRIES = 6;
const TOTALS_POLL_DELAY_MS = 1200;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** The raw OWOX API key lives in the (gitignored) dev config; the client does its own exchange. */
function readApiKey() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'owox.dev.json'), 'utf8'))?.owox?.apiKey ?? null;
  } catch { return null; }
}

let clientPromise = null;
function getClient() {
  if (!clientPromise) {
    const apiKey = readApiKey();
    if (!apiKey) return null;
    const client = new OWOXApiClient({ apiKey });
    clientPromise = client.authenticate().then(() => client);
  }
  return clientPromise;
}

/** The run's grand totals are a separate async DWH query, bridged via the run id; poll until ready. */
async function fetchRunTotals(client, martId, runId) {
  for (let i = 0; i < TOTALS_POLL_TRIES; i++) {
    let run;
    try { run = await client.getJson(`/api/data-marts/${encodeURIComponent(martId)}/runs/${encodeURIComponent(runId)}`); }
    catch { return null; }
    if (run?.totals) return run.totals;
    if (!shouldKeepPolling(run?.status)) return null; // terminal without totals (e.g. no numeric field)
    await sleep(TOTALS_POLL_DELAY_MS);
  }
  return null;
}

/** Translate one compiled QueryRequest into an api-client traversal and map the reply back. */
async function handleQuery(martId, body, res) {
  const client = await getClient();
  if (!client) {
    res.writeHead(500, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'dev shim: no owox.apiKey in owox.dev.json' }));
  }

  const askedLimit = body.limit ?? DEFAULT_LIMIT;
  const traversal = await client.dataMarts.traverseData(martId, {
    column: body.fields ?? [],
    filter: body.filterConfig ?? undefined,
    sort: body.sortConfig ?? undefined,
    aggregation: body.aggregationConfig ?? undefined,
    dateTrunc: body.dateTruncConfig ?? undefined,
    limit: askedLimit + 1, // over-read by one to detect truncation, like the backend query service
  });

  const objs = [];
  for await (const chunk of traversal.rowChunks()) objs.push(...chunk);

  // Totals are only consumed by the scorecard (aggregation, no grouping). Fetch them via the run id
  // for that case; skip the extra round-trip for grouped charts, which ignore totals.
  let totals = null;
  if (needsGrandTotal(body)) {
    if (traversal.runId) totals = await fetchRunTotals(client, martId, traversal.runId);
    if (!totals) totals = grandTotalFromRow(objs.slice(0, askedLimit), body); // fallback: single row is the total
  }

  const result = rowsToQueryResult(objs, body, askedLimit, totals);
  console.log(`  → ${result.rows.length} row(s), truncated=${result.truncated}${totals ? ', totals' : ''}${traversal.runId ? ` (run ${traversal.runId.slice(0, 8)})` : ''}`);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(result));
}

/** Everything that is not our missing endpoint goes straight to the real API, headers intact. */
async function passThrough(req, res, bodyBuf) {
  const target = new URL(req.url, UPSTREAM);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];
  delete headers['accept-encoding']; // let undici hand us a decoded body
  const up = await fetch(target, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : bodyBuf,
  });
  const buf = Buffer.from(await up.arrayBuffer());
  const out = {};
  for (const [k, v] of up.headers) {
    if (!['content-encoding', 'transfer-encoding', 'content-length', 'connection'].includes(k.toLowerCase())) out[k] = v;
  }
  res.writeHead(up.status, out);
  res.end(buf);
}

const QUERY_ROUTE = /^\/api\/data-marts\/([^/]+)\/query\/?$/;

function serve() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => void (async () => {
      const bodyBuf = Buffer.concat(chunks);
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const m = req.method === 'POST' && QUERY_ROUTE.exec(pathname);
      if (!m) return passThrough(req, res, bodyBuf);

      const martId = decodeURIComponent(m[1]);
      let body;
      try { body = JSON.parse(bodyBuf.toString('utf8') || '{}'); }
      catch { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'invalid JSON body' })); }

      console.log(`query ${martId} fields=[${(body.fields ?? []).join(',')}] aggs=${body.aggregationConfig?.length ?? 0} sort=${body.sortConfig?.length ?? 0} limit=${body.limit ?? '-'}`);
      try {
        await handleQuery(martId, body, res);
      } catch (e) {
        console.error(`  ✗ ${e.message}`);
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'shim → OWOX API call failed', detail: e.message }));
      }
    })().catch(e => {
      console.error(e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }));
  });

  server.listen(SHIM_PORT, '127.0.0.1', () => {
    console.log(`\n  dev shim → ${UPSTREAM} (via @owox/api-client, API-key auth)`);
    console.log(`  listening on http://127.0.0.1:${SHIM_PORT}`);
    console.log(`  POST /api/data-marts/:id/query  →  traverseData + run totals (aggregation, sort, limit, dateTrunc, filter)`);
    console.log(`  everything else                 →  proxied to ${UPSTREAM}`);
    console.log(readApiKey() ? '  api key: present\n' : '  api key: MISSING — set owox.apiKey in owox.dev.json\n');
  });
}

// Only act as a server when executed directly; importing this file (tests) must have no side effects.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  serve();
}
