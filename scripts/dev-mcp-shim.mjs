// DEV-ONLY scaffolding for the "Data Mart Dashboards" plugin.
//
// This script bridges the plugin's dev broker to the real app.owox.com MCP
// tool (`query_data_mart`) so local development can run against real data
// before `POST /api/data-marts/:id/query` is deployed on app.owox.com.
//
// Delete this file once that REST endpoint ships. It must never be imported
// by anything under `ui/` — it is a dev-only Node script, not part of the
// plugin's runtime bundle.

// ---------- pure query-mapping logic ----------

const NUMERIC_CELL = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

export function coerceCell(raw) {
  if (raw !== '' && NUMERIC_CELL.test(raw)) return Number(raw);
  return raw;
}

export function parseTsv(tsv) {
  if (tsv === '') return [];
  const lines = tsv.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map(line => line.split('\t').map(coerceCell));
}

export const AGG_TOKEN = {
  SUM: 'SUM', AVG: 'AVG', MIN: 'MIN', MAX: 'MAX', COUNT: 'COUNT',
  COUNT_DISTINCT: 'COUNTUNIQUE',
  P25: 'P25', P50: 'MEDIAN', P75: 'P75', P95: 'P95',
};

export function aggLabel(column, fn) {
  return `${column.replace(/\./g, '_')} | ${AGG_TOKEN[fn]}`;
}

export function mapQueryRequestToMcpArgs(dataMartId, body, opts = {}) {
  const args = { data_mart_id: dataMartId, fields: body.fields };
  if (body.aggregationConfig?.length) {
    args.aggregations = body.aggregationConfig.map(r => ({ field: r.column, function: r.function }));
  }
  if (body.dateTruncConfig?.length) {
    args.date_buckets = body.dateTruncConfig.map(r => ({
      field: r.column, unit: r.unit, ...(r.timeZone ? { time_zone: r.timeZone } : {}),
    }));
  }
  if (body.filterConfig?.length) {
    args.filters = body.filterConfig.map(r => ({
      field: r.column, operator: r.operator, ...(r.value !== undefined ? { value: r.value } : {}),
    }));
  }
  const limit = opts.limit ?? body.limit;
  if (limit !== undefined) args.limit = limit;
  return args;
}

export function resolveSortPlan(sortConfig, columns, aggregationConfig) {
  const plan = [];
  for (const rule of sortConfig) {
    let index = columns.indexOf(rule.column);
    if (index === -1) {
      const aggRule = aggregationConfig?.find(a => a.column === rule.column);
      if (aggRule) index = columns.indexOf(aggLabel(rule.column, aggRule.function));
    }
    if (index === -1) return { plan: null, unresolvedColumn: rule.column };
    plan.push({ index, direction: rule.direction });
  }
  return { plan };
}

function compareValues(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = String(a), sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export function sortAndTruncateRows(rows, plan, limit) {
  const sorted = [...rows].sort((r1, r2) => {
    for (const { index, direction } of plan) {
      const a = r1[index];
      const b = r2[index];
      // Nulls/undefined always sort last, independent of direction — the
      // direction flip below must never apply to this branch.
      if (a == null && b == null) continue;
      if (a == null) return 1;
      if (b == null) return -1;
      const cmp = compareValues(a, b);
      if (cmp !== 0) return direction === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
  return sorted.slice(0, limit);
}

// ---------- runtime: OAuth login, MCP client, proxy server ----------

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_FILE = path.join(ROOT, '.owox-dev', 'mcp-token.json');
const UPSTREAM = 'https://app.owox.com';
const MCP_URL = `${UPSTREAM}/mcp`;
const RESOURCE = MCP_URL;
const SHIM_PORT = 5300;
const CALLBACK_PORT = 5301;

// The MCP tool's `limit` caps GROUPS, not raw rows. When the plugin asks for an ordering the
// deployed tool cannot express, we pull the COMPLETE group set (aggregates still computed
// server-side) and order/select over it here. That is selection over a complete set, not
// re-aggregation of a sample. If the server says `truncated`, the set is NOT complete and the
// ordering would be a lie — we pass `truncated` through so the UI says so.
const MAX_GROUPS = 1000;

const readToken = () => {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch { return null; }
};
const writeToken = tok => {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tok, null, 2));
  fs.chmodSync(TOKEN_FILE, 0o600);
};

async function discover() {
  const r = await fetch(`${UPSTREAM}/.well-known/oauth-authorization-server`);
  if (!r.ok) throw new Error(`oauth discovery failed: ${r.status}`);
  return r.json();
}

async function login() {
  const meta = await discover();
  const reg = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'data-mart-dashboards dev shim',
      redirect_uris: [`http://127.0.0.1:${CALLBACK_PORT}/callback`],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!reg.ok) throw new Error(`client registration failed: ${reg.status} ${await reg.text()}`);
  const { client_id } = await reg.json();

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('base64url');
  const redirect = `http://127.0.0.1:${CALLBACK_PORT}/callback`;

  const url = new URL(meta.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', client_id);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'mcp:read');
  url.searchParams.set('resource', RESOURCE);

  const code = await new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const q = new URL(req.url, `http://127.0.0.1:${CALLBACK_PORT}`).searchParams;
      if (q.get('state') !== state) { res.writeHead(400).end('state mismatch'); return; }
      const c = q.get('code');
      res.writeHead(200, { 'content-type': 'text/plain' })
        .end(c ? 'Authorized. You can close this tab and return to the terminal.' : `error: ${q.get('error')}`);
      srv.close();
      c ? resolve(c) : reject(new Error(q.get('error') || 'no code'));
    });
    srv.listen(CALLBACK_PORT, '127.0.0.1', () => {
      console.log('\nOpen this URL to authorize the dev shim:\n');
      console.log(`  ${url}\n`);
      console.log('Waiting for the callback…');
    });
    setTimeout(() => { srv.close(); reject(new Error('login timed out after 5 min')); }, 300_000);
  });

  const tr = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code, client_id, redirect_uri: redirect, code_verifier: verifier, resource: RESOURCE,
    }),
  });
  if (!tr.ok) throw new Error(`token exchange failed: ${tr.status} ${await tr.text()}`);
  const tok = await tr.json();
  writeToken({ ...tok, client_id, obtained_at: Date.now() });
  console.log(`\nLogged in. Token saved to .owox-dev/mcp-token.json (gitignored).`);
}

async function refreshIfNeeded(tok) {
  if (!tok?.refresh_token) return tok;
  const meta = await discover();
  const r = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tok.refresh_token,
      client_id: tok.client_id,
      resource: RESOURCE,
    }),
  });
  if (!r.ok) return null;
  const next = { ...tok, ...(await r.json()), obtained_at: Date.now() };
  writeToken(next);
  return next;
}

/** Parse a JSON-RPC reply that may arrive as plain JSON or as an SSE stream. */
function parseRpc(text) {
  const t = text.trim();
  if (t.startsWith('{')) return JSON.parse(t);
  const payloads = t.split('\n')
    .filter(l => l.startsWith('data:'))
    .map(l => l.slice(5).trim())
    .filter(l => l && l !== '[DONE]');
  if (!payloads.length) throw new Error(`unparseable MCP reply: ${t.slice(0, 200)}`);
  return JSON.parse(payloads[payloads.length - 1]);
}

let mcpSession = null;

async function mcpRpc(token, body, extraHeaders = {}) {
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-06-18',
    ...(mcpSession ? { 'mcp-session-id': mcpSession } : {}),
    ...extraHeaders,
  };
  const r = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  const sid = r.headers.get('mcp-session-id');
  if (sid) mcpSession = sid;
  const text = await r.text();
  if (!r.ok) {
    const err = new Error(`MCP ${body.method} -> ${r.status}: ${text.slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  return parseRpc(text);
}

async function mcpInitialize(token) {
  if (mcpSession) return;
  await mcpRpc(token, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'dmd-dev-shim', version: '0.1.0' },
    },
  });
  // Best-effort notification; some servers require it before tools/call.
  try {
    await mcpRpc(token, { jsonrpc: '2.0', method: 'notifications/initialized' });
  } catch { /* not fatal */ }
}

async function callQueryTool(token, args) {
  await mcpInitialize(token);
  const reply = await mcpRpc(token, {
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'query_data_mart', arguments: args },
  });
  if (reply.error) throw new Error(`MCP error: ${JSON.stringify(reply.error).slice(0, 300)}`);
  const result = reply.result;
  let sc = result?.structuredContent;
  if (!sc && result?.content?.[0]?.text) sc = JSON.parse(result.content[0].text);
  if (result?.isError) throw new Error(`tool error: ${result?.content?.[0]?.text ?? 'unknown'}`);
  if (!sc) throw new Error('MCP reply had no structuredContent');
  return sc;
}

/** Translate our REST QueryRequest into an MCP call and map the reply back to a QueryResult. */
async function handleQuery(token, martId, body, res) {
  const wantsSort = Array.isArray(body.sortConfig) && body.sortConfig.length > 0;
  const askedLimit = body.limit ?? 20;
  // With a sort we must see every group before ordering, since the tool has no ORDER BY.
  const args = mapQueryRequestToMcpArgs(martId, body, wantsSort ? { limit: MAX_GROUPS } : {});

  const sc = await callQueryTool(token, args);
  const columns = sc.columns ?? [];
  let rows = parseTsv(typeof sc.rows === 'string' ? sc.rows : '');
  const truncated = Boolean(sc.truncated);
  let sortedHere = false;

  if (wantsSort) {
    const { plan, unresolvedColumn } = resolveSortPlan(body.sortConfig, columns, body.aggregationConfig);
    if (!plan) {
      console.warn(`  ⚠ sort column "${unresolvedColumn}" not in result columns [${columns.join(', ')}] — returning UNSORTED`);
    } else {
      if (truncated) {
        console.warn(`  ⚠ mart ${martId}: >${MAX_GROUPS} groups (truncated) — ordering is over an INCOMPLETE set, so this is not a true top-N. Passing truncated:true through.`);
      }
      rows = sortAndTruncateRows(rows, plan, askedLimit);
      sortedHere = true;
    }
  }

  console.log(`  → ${rows.length} row(s), truncated=${truncated}${sortedHere ? ', sorted-in-shim' : ''}`);
  const headers = { 'content-type': 'application/json' };
  if (sortedHere) headers['x-dmd-shim'] = 'sorted-in-shim';
  res.writeHead(200, headers);
  res.end(JSON.stringify({ columns, rows, truncated, totals: sc.totals ?? null }));
}

/** Everything that is not our missing endpoint goes straight to the real API, headers intact. */
async function passThrough(req, res, bodyBuf) {
  const target = new URL(req.url, UPSTREAM);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];
  delete headers['accept-encoding']; // let fetch/undici hand us a decoded body
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

      console.log(`query ${martId} fields=[${(body.fields ?? []).join(',')}] aggs=${body.aggregationConfig?.length ?? 0} limit=${body.limit ?? '-'}`);

      let tok = readToken();
      if (!tok?.access_token) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({
          error: 'dev shim has no MCP token',
          detail: 'Run:  npm run shim:login',
        }));
      }

      try {
        await handleQuery(tok.access_token, martId, body, res);
      } catch (e) {
        if (e.status === 401) {
          const next = await refreshIfNeeded(tok);
          if (next?.access_token) {
            mcpSession = null;
            try { return await handleQuery(next.access_token, martId, body, res); } catch (e2) { e = e2; }
          } else {
            res.writeHead(401, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ error: 'MCP token expired', detail: 'Run:  npm run shim:login' }));
          }
        }
        console.error(`  ✗ ${e.message}`);
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'shim → MCP call failed', detail: e.message }));
      }
    })().catch(e => {
      console.error(e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }));
  });

  server.listen(SHIM_PORT, '127.0.0.1', () => {
    console.log(`\n  dev MCP shim → ${UPSTREAM}`);
    console.log(`  listening on http://127.0.0.1:${SHIM_PORT}`);
    console.log(`  POST /api/data-marts/:id/query  →  MCP query_data_mart`);
    console.log(`  everything else                 →  proxied to ${UPSTREAM}`);
    console.log(readToken()?.access_token ? '  MCP token: present\n' : '  MCP token: MISSING — run `npm run shim:login`\n');
  });
}

const cmd = process.argv[2];
// Only act as a CLI when executed directly; importing this file (tests) must have no side effects.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (cmd === 'login') login().catch(e => { console.error(e.message); process.exit(1); });
  else serve();
}
