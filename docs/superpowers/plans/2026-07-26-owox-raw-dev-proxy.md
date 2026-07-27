# owox-raw dev proxy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the plugin stream Data Mart rows (and read schema/totals) through a temporary, unscoped dev-broker proxy driven by `@owox/api-client`, while the `@owox/plugin-sdk` typed client is unavailable in `owox-data-marts`.

**Architecture:** A new `owox-raw` Express router in `host-backend` transparently forwards any `/api/...` path to OWOX with the active dev project's real token (no grant check, no PII strip), mounted at `/host/owox-raw` in the dev broker. The plugin points `@owox/api-client` at that same-origin mount via a custom `fetchImpl`, and reads the two coverage gaps (schema, totals) with plain fetches through the same proxy. Isolated to ~4 files so it lifts out when the SDK client ships.

**Tech Stack:** TypeScript, Express (host-backend), `@owox/api-client` (plugin), Vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-07-25-owox-raw-dev-proxy-design.md` (feasibility-verified 2026-07-26).

## Global Constraints

- **Two repos.** Tasks 1–2 are in the **monorepo** `owox-data-marts-experimental` (`packages/host-backend`). Tasks 3–6 are in the **plugin** `data-mart-dashboardization`. Commit in the repo the task touches.
- **Dev broker only.** `owox-raw` MUST be mounted only in `dev/dev-broker.ts`. Never mount it in the real host `server.ts`.
- **`@owox/api-client` ≥ 0.29.0** — the build that encodes `aggregation`/`dateTrunc` (#1420). Older builds silently drop them and return raw rows.
- **Unscoped by design, temporary.** The proxy has no grant check and no PII strip. Both `owox-raw.ts` and `rawClient.ts` carry a `ponytail:` comment naming the removal trigger (SDK typed client available in `owox-data-marts`).
- **Test runners capped at 4 workers** (`vitest run --maxWorkers=4`).
- **Revert path:** delete `owox-raw.ts` + its mount line, delete `ui/lib/rawClient.ts`, swap `api.ts`'s import back to `@owox/plugin-sdk`'s `owox.dataMarts`, drop the `@owox/api-client` dep.

## File Structure

**Monorepo (`owox-data-marts-experimental`):**
- Create `packages/host-backend/src/owox-raw.ts` — the router (delegates to existing `callOwoxApiRaw`).
- Create `packages/host-backend/src/owox-raw.spec.ts` — supertest coverage.
- Modify `packages/host-backend/src/dev/dev-broker.ts` — mount the router.

**Plugin (`data-mart-dashboardization`):**
- Modify `package.json` — add `@owox/api-client` dependency.
- Create `ui/lib/rawClient.ts` — api-client-over-proxy client shaped like `owox.dataMarts`.
- Create `ui/lib/rawClient.test.ts` — unit tests.
- Modify `ui/lib/api.ts` — swap data source `owox.dataMarts` → `rawClient`.
- Modify `ui/lib/api.test.ts`, `ui/lib/generate.test.ts` — retarget spies to `rawClient`.
- Modify `ui/lib/types.ts` — correct the stale "IN rejected" comment.

---

### Task 1: Host `owox-raw` router  *(repo: owox-data-marts-experimental)*

**Files:**
- Create: `packages/host-backend/src/owox-raw.ts`
- Test: `packages/host-backend/src/owox-raw.spec.ts`

**Interfaces:**
- Consumes: `callOwoxApiRaw(deps, projectId, method, path, body)` and `OwoxApiDeps` from `./owox-api-client` (returns `{ status, headers, body }`, throws `{status, body}` on non-2xx); `ProjectStore` (`getActiveId()`, `list()`); `TokenProvider`.
- Produces: `owoxRawRouter(deps: OwoxRawDeps): express.Router`, where `OwoxRawDeps = OwoxApiDeps & { store: { getActiveId(): Promise<string | undefined> } }`. Mounted at `/host/owox-raw` (Task 2).

- [ ] **Step 1: Write the failing test**

Create `packages/host-backend/src/owox-raw.spec.ts` (harness mirrors `owox-proxy.spec.ts`):

```ts
import http from 'node:http';
import express from 'express';
import request from 'supertest';
import { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { owoxRawRouter } from './owox-raw';
import { ProjectStore } from './project-store';
import { createFileSecretStore } from './secret-store';
import { TokenProvider } from './owox-token';

function fakeKey(id: string) {
  return 'owox_key_' + Buffer.from(JSON.stringify({ apiOrigin: 'http://x', apiKeyId: id, apiKeySecret: 's' })).toString('base64url');
}

describe('owoxRawRouter', () => {
  let dir: string, upstream: http.Server, upstreamUrl: string, seen: any;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'raw-'));
    seen = {};
    upstream = http.createServer((req, res) => {
      seen = { url: req.url, auth: req.headers['x-owox-authorization'], apiKeyId: req.headers['x-owox-api-key-id'] };
      if (req.url?.includes('runs/')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ status: 'SUCCESS', totals: { 'x | SUM': 5 } })); }
      if (req.url?.includes('.ndjson')) { res.setHeader('content-type', 'application/x-ndjson'); res.setHeader('x-owox-run-id', 'run-7'); return res.end('{"a":1}\n{"a":2}\n'); }
      if (req.url?.includes('/boom')) { res.statusCode = 424; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ code: 'STORAGE_READ_FAILED', message: 'boom' })); }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, path: req.url }));
    });
    await new Promise<void>(r => upstream.listen(0, r));
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  });
  afterEach(async () => { await new Promise(r => upstream.close(r)); rmSync(dir, { recursive: true, force: true }); });

  async function app() {
    const store = new ProjectStore(join(dir, 'projects.json'), createFileSecretStore(join(dir, 'secrets.json')));
    await store.add({ id: 'p', name: 'P', endpoint: upstreamUrl, apiKey: fakeKey('kid-1') });
    await store.setActive('p');
    const tokens = new TokenProvider(store, async () => ({ token: 'TKN', expiresAt: Date.now() + 1e6 }));
    const a = express();
    a.use('/host/owox-raw', owoxRawRouter({ store, tokens }));
    return a;
  }

  it('short-circuits the api-key exchange without hitting upstream', async () => {
    const res = await request(await app()).post('/host/owox-raw/api/auth/api-keys/exchange').send({ apiKeySecret: 'x' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accessToken: 'dev' });
    expect(seen).toEqual({}); // upstream never called
  });

  it('forwards a data path with the injected auth headers, prefix stripped', async () => {
    const res = await request(await app()).get('/host/owox-raw/api/data-marts/dm1');
    expect(res.status).toBe(200);
    expect(seen.url).toBe('/api/data-marts/dm1');
    expect(seen.auth).toBe('Bearer TKN');
    expect(seen.apiKeyId).toBe('kid-1');
    expect(res.body).toEqual({ ok: true, path: '/api/data-marts/dm1' });
  });

  it('passes the NDJSON body and x-owox-run-id header through', async () => {
    const res = await request(await app()).get('/host/owox-raw/api/external/http-data/data-marts/dm1.ndjson?column=a');
    expect(res.status).toBe(200);
    expect(res.headers['x-owox-run-id']).toBe('run-7');
    expect(res.text).toBe('{"a":1}\n{"a":2}\n');
  });

  it('forwards an upstream error status and body', async () => {
    const res = await request(await app()).get('/host/owox-raw/api/data-marts/boom');
    expect(res.status).toBe(424);
    expect(res.body.message).toBe('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/flakss/Projects/owox-data-marts-experimental/packages/host-backend && npx vitest run src/owox-raw.spec.ts --maxWorkers=4`
Expected: FAIL — `Cannot find module './owox-raw'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/host-backend/src/owox-raw.ts`:

```ts
import express, { type Router } from 'express';
import { callOwoxApiRaw, type OwoxApiDeps } from './owox-api-client';

// ponytail: TEMPORARY dev-only, UNSCOPED OWOX proxy — no grant check, no PII strip. Exists only so the
// plugin can reach OWOX via @owox/api-client while the @owox/plugin-sdk typed `owox` client is
// unavailable in owox-data-marts. Mount ONLY in the dev broker; never in the real host. REMOVE once
// the SDK typed client ships.
export type OwoxRawDeps = OwoxApiDeps & { store: OwoxApiDeps['store'] & { getActiveId(): Promise<string | undefined> } };

export function owoxRawRouter(deps: OwoxRawDeps): Router {
  const r = express.Router();
  r.use(express.json());
  r.use((req, res) => {
    void (async () => {
      // @owox/api-client authenticates before any data call; answer the exchange locally so a
      // throwaway synthetic key works — the host injects the real token downstream, so this is ignored.
      if (req.method === 'POST' && req.path === '/api/auth/api-keys/exchange') {
        res.json({ accessToken: 'dev' });
        return;
      }
      const activeId = await deps.store.getActiveId();
      if (!activeId) { res.status(409).json({ error: 'no active project' }); return; }
      try {
        const { status, headers, body } = await callOwoxApiRaw(
          deps, activeId, req.method, req.url, req.method === 'GET' ? undefined : req.body,
        );
        if (headers['x-owox-run-id']) res.setHeader('x-owox-run-id', headers['x-owox-run-id']);
        res.setHeader('content-type', headers['content-type'] ?? 'application/json');
        res.status(status).send(typeof body === 'string' ? body : JSON.stringify(body));
      } catch (e: any) {
        res.status(e?.status ?? 502).json(e?.body ?? { error: String(e?.message ?? e) });
      }
    })();
  });
  return r;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/flakss/Projects/owox-data-marts-experimental/packages/host-backend && npx vitest run src/owox-raw.spec.ts --maxWorkers=4`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/flakss/Projects/owox-data-marts-experimental
git add packages/host-backend/src/owox-raw.ts packages/host-backend/src/owox-raw.spec.ts
git commit -m "feat(host): temporary unscoped owox-raw dev proxy (delegates to callOwoxApiRaw)"
```

---

### Task 2: Mount `owox-raw` in the dev broker  *(repo: owox-data-marts-experimental)*

**Files:**
- Modify: `packages/host-backend/src/dev/dev-broker.ts` (the `const app = express();` block near the end, ~line 167)

**Interfaces:**
- Consumes: `owoxRawRouter` from Task 1; `store` + `tokens` already constructed in `createDevBrokerApp`.
- Produces: `/host/owox-raw/*` reachable through the Vite `/host` proxy the runner already configures.

- [ ] **Step 1: Add the import**

At the top of `dev/dev-broker.ts`, alongside the other `../` imports:

```ts
import { owoxRawRouter } from '../owox-raw';
```

- [ ] **Step 2: Mount before the pluginRpc/dev routers**

In the `const app = express();` block, add the mount as the FIRST `app.use`:

```ts
  const app = express();
  // ponytail: TEMPORARY dev-only unscoped OWOX proxy for the api-client workaround. Remove with owox-raw.ts.
  app.use('/host/owox-raw', owoxRawRouter({ store, tokens }));
  app.use(pluginRpcRouter({ broker, session, activeUserId: async () => DEV_USER }));
  app.use(brokerDevRouter(log));
  return { app, token, endpoint: '/plugin-rpc' };
```

- [ ] **Step 3: Verify the broker starts and the route responds**

Run (from the plugin repo, which links the monorepo and has `owox.dev.json`):
```bash
cd /Users/flakss/Projects/data-mart-dashboardization
npm run dev:broker &   # wait ~4s for "broker: http://localhost:5278"
curl -s "http://localhost:5278/host/owox-raw/api/data-marts" | head -c 300
```
Expected: a JSON body (`{"items":[...],"total":...}`) from real OWOX — proving active-project resolution + token injection + forwarding. Then `kill %1`.

- [ ] **Step 4: Run the host-backend suite (no regressions)**

Run: `cd /Users/flakss/Projects/owox-data-marts-experimental/packages/host-backend && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/flakss/Projects/owox-data-marts-experimental
git add packages/host-backend/src/dev/dev-broker.ts
git commit -m "feat(dev): mount owox-raw proxy at /host/owox-raw in the dev broker"
```

---

### Task 3: Plugin `rawClient` over the proxy  *(repo: data-mart-dashboardization)*

**Files:**
- Modify: `package.json` (add dependency)
- Create: `ui/lib/rawClient.ts`
- Test: `ui/lib/rawClient.test.ts`

**Interfaces:**
- Consumes: `OWOXApiClient`, `TraverseDataOptions` from `@owox/api-client`; the `/host/owox-raw` proxy from Task 2.
- Produces: `rawClient` — an object shaped like the SDK's `owox.dataMarts`:
  - `list(): Promise<Array<Record<string, unknown> & { id: string; title: string }>>`
  - `getById(id: string): Promise<Record<string, unknown>>` (mart detail incl. `schema`)
  - `traverseData(id: string, opts: TraverseDataOptions): Promise<{ runId: string | undefined; rows(): Promise<Record<string, unknown>[]> }>`
  - `getRun(id: string, runId: string): Promise<{ status: string; totals: Record<string, number|string|boolean|null> | null; sql: string | null }>`
  - plus exported helper `toProxyUrl(input: string | URL): string`.

- [ ] **Step 1: Add the dependency**

Run:
```bash
cd /Users/flakss/Projects/data-mart-dashboardization
npm install @owox/api-client@^0.29.0
```
Expected: `package.json` `dependencies` gains `"@owox/api-client": "^0.29.0"` and it resolves (published latest ≥ 0.29.0).

- [ ] **Step 2: Write the failing test**

Create `ui/lib/rawClient.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @owox/api-client so we control the traversal and never hit the network.
const traverseData = vi.fn();
const list = vi.fn();
vi.mock('@owox/api-client', () => ({
  OWOXApiClient: vi.fn().mockImplementation(() => ({ dataMarts: { list, traverseData } })),
}));

import { rawClient, toProxyUrl } from './rawClient';

describe('toProxyUrl', () => {
  it('rewrites any origin to the same-origin /host/owox-raw mount, keeping path + query', () => {
    expect(toProxyUrl('http://localhost/api/data-marts/dm1?x=1'))
      .toBe(`${location.origin}/host/owox-raw/api/data-marts/dm1?x=1`);
  });
});

describe('rawClient', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

  it('traverseData delegates to api-client and flattens rowChunks into rows()', async () => {
    traverseData.mockResolvedValue({
      runId: 'run-1',
      async *rowChunks() { yield [{ a: 1 }]; yield [{ a: 2 }]; },
    });
    const t = await rawClient.traverseData('dm1', { column: ['a'], aggregation: [{ column: 'a', function: 'SUM' }] });
    expect(traverseData).toHaveBeenCalledWith('dm1', { column: ['a'], aggregation: [{ column: 'a', function: 'SUM' }] });
    expect(t.runId).toBe('run-1');
    expect(await t.rows()).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('getById fetches the mart detail through the proxy', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'dm1', schema: { fields: [] } }), { status: 200 }),
    );
    const mart = await rawClient.getById('dm1');
    expect(fetchSpy).toHaveBeenCalledWith(`${location.origin}/host/owox-raw/api/data-marts/dm1`);
    expect(mart).toMatchObject({ id: 'dm1' });
  });

  it('getRun reads totals + sql from the run through the proxy', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: 'SUCCESS', totals: { 'cost | SUM': 9 },
      additionalParams: { httpData: { executionSqlQuery: 'SELECT 1' } },
    }), { status: 200 }));
    const run = await rawClient.getRun('dm1', 'run-1');
    expect(run).toEqual({ status: 'SUCCESS', totals: { 'cost | SUM': 9 }, sql: 'SELECT 1' });
  });

  it('list delegates to api-client', async () => {
    list.mockResolvedValue([{ id: 'dm1', title: 'A' }]);
    expect(await rawClient.list()).toEqual([{ id: 'dm1', title: 'A' }]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/flakss/Projects/data-mart-dashboardization && npx vitest run ui/lib/rawClient.test.ts --maxWorkers=4`
Expected: FAIL — `Cannot find module './rawClient'`.

- [ ] **Step 4: Write minimal implementation**

Create `ui/lib/rawClient.ts`:

```ts
import { OWOXApiClient, type TraverseDataOptions } from '@owox/api-client';

// ponytail: TEMPORARY. Routes OWOX access through the dev host's unscoped /host/owox-raw proxy via
// @owox/api-client, because the @owox/plugin-sdk typed `owox` client is unavailable in
// owox-data-marts. Shaped like `owox.dataMarts` so api.ts swaps back with one import when it ships.
export const OWOX_RAW_BASE = '/host/owox-raw';

const origin = () => (typeof location !== 'undefined' ? location.origin : 'http://localhost');

/** api-client builds absolute /api/... URLs on a bare origin; rewrite each to the same-origin proxy mount. */
export function toProxyUrl(input: string | URL): string {
  const u = typeof input === 'string' ? new URL(input) : input;
  return `${origin()}${OWOX_RAW_BASE}${u.pathname}${u.search}`;
}

const proxyFetch: typeof fetch = (input, init) =>
  fetch(toProxyUrl(input instanceof Request ? input.url : (input as string | URL)), init);

// Synthetic key: bare placeholder origin (never used — proxyFetch rewrites), throwaway id/secret. The
// dev proxy short-circuits the exchange so authenticate() succeeds with this.
const SYNTH_KEY =
  'owox_key_' +
  btoa(JSON.stringify({ apiOrigin: 'http://localhost', apiKeyId: 'dev', apiKeySecret: 'dev' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const client = new OWOXApiClient({ apiKey: SYNTH_KEY, fetchImpl: proxyFetch });

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${origin()}${OWOX_RAW_BASE}${path}`);
  if (!res.ok) throw Object.assign(new Error(`OWOX ${res.status}`), { status: res.status });
  return res.json() as Promise<T>;
}

export const rawClient = {
  list: () => client.dataMarts.list(),

  getById: (id: string) => getJson<Record<string, unknown>>(`/api/data-marts/${encodeURIComponent(id)}`),

  async traverseData(id: string, opts: TraverseDataOptions) {
    const t = await client.dataMarts.traverseData(id, opts);
    return {
      runId: t.runId,
      rows: async () => {
        const out: Record<string, unknown>[] = [];
        for await (const chunk of t.rowChunks()) out.push(...chunk);
        return out;
      },
    };
  },

  getRun: (id: string, runId: string) =>
    getJson<{ status?: string; totals?: Record<string, number | string | boolean | null> | null; additionalParams?: any; reportDefinition?: any }>(
      `/api/data-marts/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`,
    ).then(r => ({
      status: r.status ?? 'UNKNOWN',
      totals: r.totals ?? null,
      sql: r.additionalParams?.httpData?.executionSqlQuery ?? r.reportDefinition?.executionSqlQuery ?? null,
    })),
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/flakss/Projects/data-mart-dashboardization && npx vitest run ui/lib/rawClient.test.ts --maxWorkers=4`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/flakss/Projects/data-mart-dashboardization
git add package.json package-lock.json ui/lib/rawClient.ts ui/lib/rawClient.test.ts
git commit -m "feat(data): rawClient — @owox/api-client over the /host/owox-raw dev proxy (temporary)"
```

---

### Task 4: Swap `api.ts` to `rawClient` + retarget test spies  *(repo: data-mart-dashboardization)*

**Files:**
- Modify: `ui/lib/api.ts` (import + 4 call sites)
- Modify: `ui/lib/api.test.ts` (spy target + import)
- Modify: `ui/lib/generate.test.ts` (spy target + import)

**Interfaces:**
- Consumes: `rawClient` from Task 3 (same method shape `api.ts` already relied on from `owox.dataMarts`).
- Produces: no signature change to `listMarts` / `getMartFields` / `queryDataMart`; only their data source changes.

- [ ] **Step 1: Swap the source in `api.ts`**

Replace the SDK import:
```ts
import { owox } from '@owox/plugin-sdk';
```
with:
```ts
import { rawClient } from './rawClient';
```
Then replace every `owox.dataMarts.` with `rawClient.` (four call sites: `list()` in `listMarts`, `getById(id)` in `getMartFields`, `traverseData(...)` in `queryDataMart`, `getRun(...)` in `fetchRunTotals`). No other logic changes (the strict getRunById-only totals path is unchanged).

- [ ] **Step 2: Retarget spies in `api.test.ts`**

Replace `import { owox } from '@owox/plugin-sdk';` with `import { rawClient } from './rawClient';`, then replace every `vi.spyOn(owox.dataMarts, 'X')` with `vi.spyOn(rawClient, 'X')` (methods: `list`, `getById`, `traverseData`, `getRun`). The mock return values and assertions are unchanged.

- [ ] **Step 3: Retarget spies in `generate.test.ts`**

Same substitution: `import { rawClient } from './rawClient';` and `vi.spyOn(rawClient, 'traverseData' | 'getRun')` in place of `owox.dataMarts`.

- [ ] **Step 4: Typecheck + run the affected suites**

Run:
```bash
cd /Users/flakss/Projects/data-mart-dashboardization
npm run typecheck
npx vitest run ui/lib/api.test.ts ui/lib/generate.test.ts --maxWorkers=4
```
Expected: typecheck clean; both suites PASS.

- [ ] **Step 5: Run the whole plugin suite (no regressions)**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add ui/lib/api.ts ui/lib/api.test.ts ui/lib/generate.test.ts
git commit -m "feat(data): route the data layer through rawClient (api-client dev proxy)"
```

---

### Task 5: End-to-end verification through the dev broker  *(repo: data-mart-dashboardization)*

**Files:** none created — verification only.

**Interfaces:** Consumes everything above, running against real `app.owox.com` via `owox.dev.json`.

- [ ] **Step 1: Ensure `@owox/api-client` ≥ 0.29.0 is resolved**

Run: `cd /Users/flakss/Projects/data-mart-dashboardization && node -e "console.log(require('@owox/api-client/package.json').version)"`
Expected: `0.29.0` or higher. (If lower, `npm install @owox/api-client@latest`.)

- [ ] **Step 2: Start the dev broker**

Run: `npm run dev:broker &` — wait for `broker: http://localhost:5278`.

- [ ] **Step 3: Verify an aggregated stream through the proxy**

Run:
```bash
curl -s "http://localhost:5278/host/owox-raw/api/external/http-data/data-marts/bad7e127-2352-4663-8b68-cbd06a9c0eb7.ndjson?column=country&aggregation=$(node -e "process.stdout.write(Buffer.from(JSON.stringify([{column:'country',function:'COUNT_DISTINCT'}])).toString('base64url'))")&limit=2"
```
Expected: NDJSON line `{"country | COUNTUNIQUE":18,...}` — proving aggregation flows through owox-raw.

- [ ] **Step 4: Verify in the UI**

Open `http://localhost:5277/`, generate/open the Countries dashboard. Expected: dimension charts render with data (rows load via `rawClient.traverseData` through the proxy). Then `kill %1`.

- [ ] **Step 5: Commit (if any verification tweaks were needed)**

No code expected; skip if clean.

---

### Task 6: Correct the stale `IN` comment  *(repo: data-mart-dashboardization)*

**Files:**
- Modify: `ui/lib/types.ts` (the `FilterRule` doc comment)

**Interfaces:** none — comment only. (Feasibility proved `IN` is honored server-side.)

- [ ] **Step 1: Update the comment**

Replace:
```ts
/** `in`/`not_in`/`this_week` are REJECTED by the service — never emit them. */
```
with:
```ts
/** `in`/`not_in` ARE supported by the HTTP Data service (verified 2026-07-26). `this_week` is not — never emit it. */
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/flakss/Projects/data-mart-dashboardization && npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add ui/lib/types.ts
git commit -m "docs(types): IN/NOT_IN are supported by the HTTP Data service (verified)"
```

---

## Self-Review

**Spec coverage:** §2 host proxy → Tasks 1–2. §3 plugin rawClient (fetchImpl, gap methods, version floor) → Tasks 3–4. Security/lifecycle (ponytail markers, dev-only mount, revert) → constraints + Tasks 1–2 comments. Testing (host spec, rawClient test, e2e) → Tasks 1, 3, 5. Feasibility "IN stale comment" → Task 6. Covered.

**Placeholders:** none — every step has runnable commands or complete code.

**Type consistency:** `rawClient` methods (`list`/`getById`/`traverseData`/`getRun`) match across Task 3 (definition), Task 4 (consumption), and the existing `api.ts` call sites. `traverseData` returns `{ runId, rows() }` (Task 3) which `api.ts` consumes as `traversal.runId` + `traversal.rows()` (unchanged). `getRun` returns `{ status, totals, sql }` matching `fetchRunTotals`'s existing usage. `owoxRawRouter(deps)` signature is identical in Task 1 (produce) and Task 2 (consume).
