# owox-raw dev proxy — design

**Date:** 2026-07-25 (feasibility-verified 2026-07-26)
**Status:** approved, ready for planning
**Scope:** temporary workaround, dev broker only

## Problem

The plugin gets Data Mart data through `@owox/plugin-sdk`'s typed `owox` client
(`dataMarts.list/getById/traverseData/getRun`). That typed client is **not yet available in the real
`owox-data-marts`** product. `@owox/api-client` (the public, credential-based client) is available,
but its coverage is incomplete — `DataMartsApi` has only `list()` and `traverseData()`, with **no
`getById` (schema)** and **no `getRun` (totals)**, both of which the plugin needs
(https://docs.owox.com/docs/api/coverage/).

We need a temporary bridge so the plugin can keep working — chiefly **streaming Data Mart rows**
(https://docs.owox.com/docs/api/api-client/#stream-data-mart-rows) — until the SDK typed client ships.

## Feasibility (verified 2026-07-26, against a mock `owox-raw` forwarding to real `app.owox.com`)

- ❌ A synthetic key with a **path-bearing** `apiOrigin` (`…/host/owox-raw`) is rejected — api-client's
  `parseApiOrigin` requires a bare origin (`pathname === '/'`). So the plugin uses a **bare placeholder
  origin** + a custom `fetchImpl` that rewrites each request to the same-origin proxy mount.
- ✅ `@owox/api-client` encodes `aggregation`/`dateTrunc` (`#1420 "stream aggregations and date
  buckets"`); an aggregated `traverseData` returns aggregated rows (`{"country | COUNTUNIQUE":18}`)
  through the proxy. **No query-injection workaround needed.** NOTE: the feasibility test built from
  current source (labeled v0.29.0), but the PUBLISHED npm package only carries `aggregation`/`dateTrunc`
  in its types from **0.30.0** onward — so the real floor is **≥ 0.30.0** (the plugin pins `^0.30.1`).
- ✅ The `IN` operator is honored server-side (`filter:[{column, operator:'in', value:[…]}]` returned
  exactly the listed values). The plugin's `types.ts` note *"`in`/`not_in` are REJECTED"* is **stale**.
- ✅ Gap methods (`getById` schema, `getRun` totals) work as plain fetches through the same proxy.
- **Consequence:** the api-client build MUST be **≥ 0.30.0** (published 0.29.x lacks `aggregation`
  types; the vendored `dist` was also stale). The plugin pins `^0.30.1`.

## Decision summary

| Question | Decision |
|---|---|
| Where does `@owox/api-client` run? | In the **plugin**, pointed at a host proxy (host holds the token). |
| Shape of the host bridge | **Transparent path proxy** — forwards any `/api/...` path (covers schema/totals gaps too). |
| Target environment | **Dev broker only** (`owox-plugin-dev`). Not the real host. |
| Credential exposure | Acceptable, temporary: the proxy is **unscoped** (full active-project access, no grant check). |

## Architecture

```
Vite :5277 (plugin page, SAME-ORIGIN — not a sandboxed iframe in dev)
   @owox/api-client.dataMarts.traverseData(...)  ─┐
   fetch('/host/owox-raw/api/data-marts/:id')     ├─▶  /host/owox-raw/*
   fetch('/host/owox-raw/api/.../runs/:runId')    ─┘        │ (Vite already proxies /host → broker)
                                                            ▼
                                              broker :5278  owox-raw router
                                                • resolve ACTIVE project (ProjectStore)
                                                • mint REAL token (TokenProvider.tokenFor)
                                                • strip '/host/owox-raw' prefix
                                                • pipe → project.endpoint + /api/...
                                                            │  (X-OWOX-Authorization + x-owox-api-key-id)
                                                            ▼
                                                       app.owox.com
```

No CORS and no sandbox concerns: in dev the plugin UI is served **same-origin** by Vite, which
already proxies `/host` and `/plugin-rpc` to the broker (`owox-plugin-dev.mjs`). The real host (where
the plugin runs in a sandboxed null-origin iframe) is explicitly **out of scope**.

## Component 1 — Host: `owox-raw.ts`

**File:** `packages/host-backend/src/owox-raw.ts` (in `owox-data-marts-experimental`).
**Export:** `owoxRawRouter({ store, tokens })` — an Express router.
**Mount:** in `packages/host-backend/src/dev/dev-broker.ts`, before `pluginRpcRouter`/SPA:

```ts
app.use('/host/owox-raw', owoxRawRouter({ store, tokens }));
```

Adapted from the existing `owox-proxy.ts` (already a no-grant, no-PII passthrough for the host's own
SPA), with three differences:

1. **Prefix strip** — mounted at `/host/owox-raw`, so forward `req.url` (the path *after* the mount)
   as `project.endpoint + req.url`, not `req.originalUrl`.
2. **Exchange short-circuit** — `POST …/api/auth/api-keys/exchange` returns `{ accessToken: 'dev' }`
   locally instead of forwarding. `@owox/api-client` runs its auth step against its `apiOrigin` before
   any data call; since the host injects the *real* token downstream, the plugin's token is a
   throwaway. This lets the plugin construct api-client with a synthetic key and no real secret.
3. **No grant check, no PII strip** — the deliberate, temporary exposure. Any caller reaching the
   route gets the active dev project's full access.

Everything else mirrors `owox-proxy.ts`: resolve active project, mint token, forward upstream **status +
headers (including `x-owox-run-id`) + body**. It reuses `callOwoxApiRaw`, which BUFFERS the body
(`res.text()`) rather than piping bytes — fine for a dev tool at these data sizes, not true streaming.
A null/empty upstream body is forwarded as an empty response (never the literal `"null"`). Reuses the
host's existing OWOX request plumbing (token mint + `http(s).request` pipe); it does **not** import
`@owox/api-client` — a path proxy cannot use api-client's method-based API, and the host plumbing
already does exactly this. (This is the one deviation from the literal "wrapper over api-client":
api-client runs in the *plugin*, not the host.)

## Component 2 — Plugin: `rawClient.ts`

**File:** `ui/lib/rawClient.ts` (in `data-mart-dashboardization`).
**Dependency:** add `@owox/api-client` (**≥ 0.30.0**, plugin pins `^0.30.1`) — deliberate & temporary,
overrides the AGENTS.md "do not import `@owox/api-client`" rule for this workaround. The floor matters:
published builds before 0.30.0 lack `aggregation`/`dateTrunc` in `TraverseDataOptions` and return raw rows.

Exposes an object **shaped exactly like the SDK's `owox.dataMarts`** — `list`, `getById`,
`traverseData`, `getRun` — so `api.ts` swaps its data source with a single import change and everything
downstream (`httpData.ts`, `sdk-mock.ts`, tests) is untouched.

- One shared `OWOXApiClient` built from a **synthetic key with a bare placeholder origin**
  (`apiOrigin = 'http://localhost'`, `apiKeyId/secret = 'dev'` — the origin is never used) plus a custom
  **`fetchImpl` that is a pure origin-rewriter**: it takes api-client's would-be URL and refetches
  `location.origin + '/host/owox-raw' + pathname + search`, same-origin. Stateless → concurrency-safe.
- `traverseData(id, opts)` → `client.dataMarts.traverseData(id, opts)` passing the **full** options
  (`column/aggregation/dateTrunc/filter/sort/limit`) verbatim; api-client ≥0.30.0 encodes them all
  (verified). Returns api-client's own `DataMartDataTraversal` (`runId`, `rowChunks()`) — the
  shape `api.ts` already consumes. No manual query building, no `getStream`, no injection.
- `list()` / `getById(id)` / `getRun(id, runId)` → plain `fetch('/host/owox-raw/api/…')` and parse
  JSON (the coverage gaps api-client doesn't provide). `getRun` reads the top-level `totals`
  and `additionalParams.httpData.executionSqlQuery`/`reportDefinition.executionSqlQuery` for `sql`,
  matching the SDK client's `{ status, totals, sql }` shape.
- The exchange short-circuit in `owox-raw` (§2) lets `client.authenticate()` succeed with the throwaway
  key before the first data call.

**`api.ts` change:** replace `owox.dataMarts` (from `@owox/plugin-sdk`) with `rawClient`. That is the
only edit to the existing data layer. The strict getRunById-only totals behavior is preserved (totals
still come solely from `getRun`).

## Security & lifecycle

- **Scope:** dev broker only, unscoped by design. MUST NOT be mounted in the real host `server.ts`.
- **Marker:** a `ponytail:` comment on both `owox-raw.ts` and `rawClient.ts` naming this a temporary
  workaround and the removal trigger (the SDK typed client becoming available in `owox-data-marts`).
- **Revert (isolated to ~3 files + one dep):**
  1. delete `packages/host-backend/src/owox-raw.ts` and its mount line in `dev-broker.ts`;
  2. delete `ui/lib/rawClient.ts`;
  3. swap `api.ts`'s import back to `@owox/plugin-sdk`'s `owox.dataMarts`;
  4. drop the `@owox/api-client` plugin dependency.

## Testing

- **Host** — `owox-raw.spec.ts` (mirrors `owox-proxy.spec.ts`): (a) `POST /api/auth/api-keys/exchange`
  returns `{ accessToken }` without forwarding; (b) a data path forwards to
  `project.endpoint + <stripped path>` with the injected `X-OWOX-Authorization` + `x-owox-api-key-id`
  headers and pipes the response back (including `x-owox-run-id`).
- **Plugin** — `rawClient.test.ts`: the four methods map to the right proxy calls (mock `fetch` and the
  api-client instance); existing `api.test.ts` stays green after the source swap (spies retarget to
  `rawClient`).
- **End-to-end** — a `scripts/`-style check (like `repro-query.mjs`) that rows stream through
  `/host/owox-raw` against a running dev broker.

## Out of scope

- Real deployed host (sandboxed iframe + CORS).
- Grant checking / PII stripping on the proxy (intentionally omitted; temporary).
- Any change to the committed SDK-based path beyond the single `api.ts` import swap.
