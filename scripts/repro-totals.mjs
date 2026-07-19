#!/usr/bin/env node
// Standalone reproduction of the MISSING RUN TOTALS problem, end to end, with NO plugin/SDK/broker.
// The scorecard number must come strictly from the run: traverseData → x-owox-run-id → getRunById
// (`GET /api/data-marts/:id/runs/:runId`) → top-level `totals`. This script runs exactly that flow
// against a hardcoded Data Mart and shows that `totals` stays `null` on the live backend even after
// the run reaches SUCCESS — while the streamed row plainly carries the aggregate. That gap is why a
// scorecard renders empty under strict getRunById-only totals.
//
// Usage:  node scripts/repro-totals.mjs <owox-api-key> [api-url]
//   <owox-api-key>  the OWOX API key (owox_key_…); the endpoint is embedded in it, so [api-url] is
//                   optional and only needed to override it (defaults to the key's apiOrigin).
import { Buffer } from 'node:buffer';

// ── Hardcoded target (🥈 Countries (E-Commerce)) and a scorecard-shaped aggregation ────────────────
const DATA_MART_ID = 'bad7e127-2352-4663-8b68-cbd06a9c0eb7';
const AGG_COLUMN = 'country';              // a reportable (non-hidden) column on this mart
const AGG_FUNCTION = 'COUNT_DISTINCT';     // scorecard: aggregation, NO grouping → totals expected
const POLLS = 8;
const POLL_DELAY_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (v) => Buffer.from(JSON.stringify(v)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function main() {
  const [apiKey, apiUrl] = process.argv.slice(2);
  if (!apiKey) throw new Error('Usage: node scripts/repro-totals.mjs <owox-api-key> [api-url]');
  const { apiOrigin, apiKeyId, apiKeySecret } = JSON.parse(Buffer.from(apiKey.replace(/^owox_key_/, ''), 'base64url').toString('utf8'));
  const base = apiUrl || apiOrigin;

  // Exchange the API key for a bearer token (same as the host's TokenProvider).
  const ex = await fetch(`${apiOrigin}/api/auth/api-keys/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owox-api-key-id': apiKeyId },
    body: JSON.stringify({ apiKeySecret }),
  });
  if (!ex.ok) throw new Error(`token exchange failed: ${ex.status} ${await ex.text()}`);
  const { accessToken } = await ex.json();
  const H = { 'X-OWOX-Authorization': `Bearer ${accessToken}`, 'x-owox-api-key-id': apiKeyId, 'content-type': 'application/json' };

  console.log(`base=${base}`);
  console.log(`mart=${DATA_MART_ID}  scorecard: ${AGG_FUNCTION}(${AGG_COLUMN}), no grouping\n`);

  // 1. traverseData: the http-data stream. Grab the aggregated row + the run id from x-owox-run-id.
  const qs = new URLSearchParams([
    ['column', AGG_COLUMN],
    ['aggregation', b64url([{ column: AGG_COLUMN, function: AGG_FUNCTION }])],
    ['limit', '2'],
  ]);
  const streamRes = await fetch(`${base}/api/external/http-data/data-marts/${DATA_MART_ID}.ndjson?${qs}`, { headers: H });
  const streamBody = (await streamRes.text()).trim();
  const runId = streamRes.headers.get('x-owox-run-id');
  console.log(`[1] traverseData  → ${streamRes.status}`);
  console.log(`    x-owox-run-id : ${runId}`);
  console.log(`    streamed row  : ${streamBody}   ← the aggregate IS here`);
  if (!runId) throw new Error('No x-owox-run-id header — cannot follow the getRunById totals flow.');

  // 2. getRunById: the ONLY sanctioned totals source. Poll it and watch `totals` stay null.
  console.log(`\n[2] getRunById poll (GET /api/data-marts/${DATA_MART_ID}/runs/${runId}):`);
  let sawTotals = null;
  for (let i = 0; i < POLLS; i++) {
    const r = await fetch(`${base}/api/data-marts/${DATA_MART_ID}/runs/${runId}`, { headers: H });
    const run = JSON.parse(await r.text());
    const hasTotalsField = Object.prototype.hasOwnProperty.call(run, 'totals');
    console.log(`    poll ${i}: status=${run.status}  totals(field ${hasTotalsField ? 'present' : 'ABSENT'})=${JSON.stringify(run.totals)}`);
    if (run.totals) { sawTotals = run.totals; break; }
    if (!['PENDING', 'RUNNING'].includes(run.status)) break; // terminal, no point polling further
    await sleep(POLL_DELAY_MS);
  }

  console.log('\n─────────────────────────────────────────────');
  if (sawTotals) {
    console.log(`✓ getRunById returned totals: ${JSON.stringify(sawTotals)} — the scorecard would render.`);
    process.exit(0);
  } else {
    console.log('✗ REPRODUCED: run reached a terminal status but getRunById.totals is null.');
    console.log('  Strict getRunById-only ⇒ the scorecard has no number to show, even though the');
    console.log('  streamed row above carries the aggregate. Fix belongs upstream (populate run totals).');
    process.exit(1);
  }
}

main().catch((e) => { console.error(`\nERROR: ${e.message}`); process.exit(2); });
