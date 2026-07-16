// DEV-ONLY scaffolding for the "Data Mart Dashboards" plugin.
//
// The plugin compiles every dashboard component into ONE server-side aggregated query and
// calls `POST /api/data-marts/:id/query`. That REST endpoint exists in our owox-data-marts
// branch but is NOT deployed on app.owox.com. However, the SAME server-side aggregation IS
// deployed, on the API key, through the HTTP Data API:
//
//   GET /api/external/http-data/data-marts/:id.ndjson?column=…&aggregation=…&sort=…&limit=…
//
// It supports aggregation, date buckets, filters and server-side sort (ORDER BY before LIMIT),
// using the SAME domain config schemas our compile.ts already targets — so the mapping is 1:1.
// This shim speaks our REST contract and translates to that endpoint on the same API-key auth
// the broker already attaches. No OAuth, no MCP. Everything else proxies straight through.
//
// Delete this file once `POST /api/data-marts/:id/query` ships. It must never be imported by
// anything under `ui/` — it is a dev-only Node script, not part of the plugin's bundle.

// ---------- pure mapping logic (unit-tested) ----------

/**
 * The HTTP Data API names an aggregated output column `<column> | <TOKEN>`, sanitising dots to
 * `_` — identical to the plugin's own `aggLabel` and to the backend's aggregation-labels.ts.
 * The plugin reads results back by this key, so it must match byte-for-byte.
 */
export const AGG_TOKEN = {
  SUM: 'SUM', AVG: 'AVG', MIN: 'MIN', MAX: 'MAX', COUNT: 'COUNT',
  COUNT_DISTINCT: 'COUNTUNIQUE',
  P25: 'P25', P50: 'MEDIAN', P75: 'P75', P95: 'P95',
};

export function aggLabel(column, fn) {
  return `${column.replace(/\./g, '_')} | ${AGG_TOKEN[fn]}`;
}

const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');

/** The output column names the plugin expects, in the order it projected them. */
export function expectedColumns(body) {
  const agg = new Map((body.aggregationConfig ?? []).map(a => [a.column, a.function]));
  return (body.fields ?? []).map(f => (agg.has(f) ? aggLabel(f, agg.get(f)) : f));
}

/**
 * Our QueryRequest -> HTTP Data API query string. `overLimit` is the row cap we actually send:
 * we over-read by one (like the backend's own query service) so we can detect truncation.
 * The four config arrays are our compile.ts output verbatim — the endpoint's domain schemas
 * use the same `column`/`function`/`unit`/`direction`/`operator` field names, so no renaming.
 */
export function buildHttpDataQuery(body, overLimit) {
  const p = new URLSearchParams();
  for (const f of body.fields ?? []) p.append('column', f);
  if (body.filterConfig?.length) p.set('filter', b64(body.filterConfig));
  if (body.aggregationConfig?.length) p.set('aggregation', b64(body.aggregationConfig));
  if (body.dateTruncConfig?.length) p.set('dateTrunc', b64(body.dateTruncConfig));
  if (body.sortConfig?.length) p.set('sort', b64(body.sortConfig));
  if (overLimit != null) p.set('limit', String(overLimit));
  return p.toString();
}

const ROW_COUNT_KEY = 'Row Count'; // grouping metadata the endpoint appends; not a plugin column

/**
 * NDJSON body -> our QueryResult. `askedLimit` is the limit the PLUGIN requested (we fetched one
 * more): if more rows came back, the result is truncated and we slice to askedLimit. `totals` is
 * populated only for a grand-total query (aggregation with no grouping dimension) — the single
 * returned row IS the total — which is exactly what the scorecard reads.
 */
export function ndjsonToQueryResult(text, body, askedLimit) {
  const objs = text.split('\n').map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l));
  const truncated = askedLimit != null && objs.length > askedLimit;
  const kept = truncated ? objs.slice(0, askedLimit) : objs;

  const columns = kept.length
    ? Object.keys(kept[0]).filter(k => k !== ROW_COUNT_KEY)
    : expectedColumns(body);
  const rows = kept.map(o => columns.map(c => (o[c] ?? null)));

  let totals = null;
  const aggCols = new Set((body.aggregationConfig ?? []).map(a => a.column));
  const dimensions = (body.fields ?? []).filter(f => !aggCols.has(f));
  if (body.aggregationConfig?.length && dimensions.length === 0 && kept.length) {
    totals = {};
    for (const c of columns) totals[c] = kept[0][c];
  }
  return { columns, rows, truncated, totals };
}

// ---------- runtime: REST translation proxy ----------

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UPSTREAM = 'https://app.owox.com';
const SHIM_PORT = 5300;
const DEFAULT_LIMIT = 20;

const QUERY_ROUTE = /^\/api\/data-marts\/([^/]+)\/query\/?$/;

/** Translate one compiled QueryRequest into an HTTP Data API call and map the reply back. */
async function handleQuery(martId, body, reqHeaders, res) {
  const askedLimit = body.limit ?? DEFAULT_LIMIT;
  const qs = buildHttpDataQuery(body, askedLimit + 1); // over-read by one to detect truncation
  const url = `${UPSTREAM}/api/external/http-data/data-marts/${encodeURIComponent(martId)}.ndjson?${qs}`;

  // Reuse the auth the broker already attached; the endpoint streams NDJSON.
  const headers = {};
  for (const h of ['x-owox-authorization', 'authorization', 'x-owox-api-key-id', 'cookie']) {
    if (reqHeaders[h]) headers[h] = reqHeaders[h];
  }
  const up = await fetch(url, { headers });
  const text = await up.text();
  if (!up.ok) {
    console.error(`  ✗ http-data ${up.status}: ${text.slice(0, 200)}`);
    res.writeHead(up.status, { 'content-type': 'application/json' });
    return res.end(text || JSON.stringify({ error: 'http-data call failed' }));
  }

  const result = ndjsonToQueryResult(text, body, askedLimit);
  console.log(`  → ${result.rows.length} row(s), truncated=${result.truncated}${result.totals ? ', total' : ''}`);
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
        await handleQuery(martId, body, req.headers, res);
      } catch (e) {
        console.error(`  ✗ ${e.message}`);
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'shim → http-data call failed', detail: e.message }));
      }
    })().catch(e => {
      console.error(e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }));
  });

  server.listen(SHIM_PORT, '127.0.0.1', () => {
    console.log(`\n  dev shim → ${UPSTREAM} (OWOX REST, API-key auth)`);
    console.log(`  listening on http://127.0.0.1:${SHIM_PORT}`);
    console.log(`  POST /api/data-marts/:id/query  →  GET …/http-data/:id.ndjson (server-side aggregation + sort)`);
    console.log(`  everything else                 →  proxied to ${UPSTREAM}\n`);
  });
}

// Only act as a server when executed directly; importing this file (tests) must have no side effects.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  serve();
}
