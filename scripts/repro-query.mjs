#!/usr/bin/env node
// Standalone reproduction of the plugin's OWOX HTTP Data query, for debugging errors like the
// transient `424 FAILED_DEPENDENCY` ("Storage dependency failed while reading this Data Mart data")
// that only surface against live data. No plugin/SDK/broker needed — it mints a token from the OWOX
// API key and hits the same endpoint api.ts calls, so a failure here IS the failure the plugin sees.
//
// Usage:
//   node scripts/repro-query.mjs [martId] [--all-fields] [--repeat N]
//
//   martId        Data Mart to query. Defaults to $OWOX_MART_ID, else lists marts and picks the first.
//   --all-fields  Also query fields flagged isHiddenForReporting (these 400 "Unknown column").
//   --repeat N    Fire each query N times concurrently (default 1) — flushes out transient 424s.
//
// Credentials (first found wins):
//   $OWOX_API_KEY + $OWOX_API_URL, else ./owox.dev.json { owox: { apiKey, apiUrl } }.
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const martArg = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--repeat');

function loadCreds() {
  if (process.env.OWOX_API_KEY) {
    return { apiKey: process.env.OWOX_API_KEY, apiUrl: process.env.OWOX_API_URL };
  }
  try {
    const cfg = JSON.parse(readFileSync(new URL('../owox.dev.json', import.meta.url), 'utf8'));
    return { apiKey: cfg.owox?.apiKey, apiUrl: cfg.owox?.apiUrl };
  } catch {
    throw new Error('No credentials: set $OWOX_API_KEY (+ $OWOX_API_URL) or create owox.dev.json');
  }
}

function parseKey(apiKey) {
  return JSON.parse(Buffer.from(apiKey.replace(/^owox_key_/, ''), 'base64url').toString('utf8'));
}

const b64url = (v) =>
  Buffer.from(JSON.stringify(v)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Mirrors ui/lib/httpData.ts aggLabel — the endpoint names an aggregated column `<col> | <TOKEN>`.
const AGG_TOKEN = { SUM: 'SUM', AVG: 'AVG', MIN: 'MIN', MAX: 'MAX', COUNT: 'COUNT', COUNT_DISTINCT: 'COUNTUNIQUE' };

async function main() {
  const { apiKey, apiUrl } = loadCreds();
  if (!apiKey) throw new Error('No OWOX API key found.');
  const { apiOrigin, apiKeyId, apiKeySecret } = parseKey(apiKey);
  const base = apiUrl || apiOrigin;

  // 1. Exchange the API key for a bearer token (same as the host's TokenProvider).
  const ex = await fetch(`${apiOrigin}/api/auth/api-keys/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owox-api-key-id': apiKeyId },
    body: JSON.stringify({ apiKeySecret }),
  });
  if (!ex.ok) throw new Error(`token exchange failed: ${ex.status} ${await ex.text()}`);
  const { accessToken } = await ex.json();
  const H = { 'X-OWOX-Authorization': `Bearer ${accessToken}`, 'x-owox-api-key-id': apiKeyId };
  console.log(`base=${base}  apiKeyId=${apiKeyId}`);

  // 2. Resolve the mart id.
  let martId = martArg || process.env.OWOX_MART_ID;
  if (!martId) {
    const list = await (await fetch(`${base}/api/data-marts`, { headers: H })).json();
    const arr = Array.isArray(list) ? list : list.items ?? list.data ?? [];
    martId = arr[0]?.id;
    console.log(`no martId given — using first: ${martId} "${arr[0]?.title}"`);
  }

  // 3. Read the schema; split reportable vs hidden.
  const det = await (await fetch(`${base}/api/data-marts/${martId}`, { headers: H })).json();
  const fields = det.schema?.fields ?? [];
  const reportable = fields.filter((f) => !f.isHiddenForReporting);
  const hidden = fields.filter((f) => f.isHiddenForReporting);
  console.log(`\nmart ${martId} "${det.title}"`);
  console.log(`  reportable: ${reportable.map((f) => `${f.name}:${f.type}`).join(', ') || '(none)'}`);
  console.log(`  hidden:     ${hidden.map((f) => `${f.name}:${f.type}`).join(', ') || '(none)'}`);

  const NUMERIC = /^(INT|FLOAT|NUMERIC|BIGNUMERIC|DECIMAL|DOUBLE|LONG)/i;
  const use = flag('--all-fields') ? fields : reportable;
  const repeat = Math.max(1, Number(opt('--repeat', '1')) || 1);

  // 4. Build the queries the plugin would issue for this mart.
  const queries = [];
  // a scorecard per aggregatable field: numeric -> SUM, else -> COUNT_DISTINCT (matches api.ts defaults)
  for (const f of use) {
    const fn = NUMERIC.test(f.type) ? 'SUM' : 'COUNT_DISTINCT';
    queries.push({ label: `scorecard ${fn}(${f.name})`, params: [['column', f.name], ['aggregation', b64url([{ column: f.name, function: fn }])], ['limit', '2']] });
  }
  // a detail table over every used field
  if (use.length) {
    queries.push({ label: `table [${use.map((f) => f.name).join(', ')}]`, params: [...use.map((f) => ['column', f.name]), ['limit', '101']] });
  }

  // 5. Run them; print status + (on error) the full body, which carries the 424 storage detail.
  let failures = 0;
  for (const q of queries) {
    const qs = new URLSearchParams();
    for (const [k, v] of q.params) qs.append(k, v);
    const url = `${base}/api/external/http-data/data-marts/${martId}.ndjson?${qs}`;
    const runs = await Promise.all(
      Array.from({ length: repeat }, async () => {
        const s = Date.now();
        const r = await fetch(url, { headers: H });
        const body = await r.text();
        return { status: r.status, ms: Date.now() - s, runId: r.headers.get('x-owox-run-id'), body };
      }),
    );
    const bad = runs.filter((r) => r.status !== 200);
    failures += bad.length;
    const summary = runs.map((r) => `${r.status}/${r.ms}ms`).join(' ');
    console.log(`\n[${q.label}] ${summary}`);
    if (bad.length) {
      console.log(`  ${url}`);
      console.log(`  ${bad[0].body.slice(0, 600)}`);
    }
  }

  console.log(`\n${failures ? `✗ ${failures} failing request(s) reproduced` : '✓ all requests returned 200'}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(`\nERROR: ${e.message}`); process.exit(2); });
