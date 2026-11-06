# Schedules and the shared Data Mart cache

Date: 2026-11-05. Compatibility line 0.4 (`/v4/`).

## 1. Goal

Each member sets their own schedules in Settings → Schedules. A scheduled run reads the Data Marts the member's model uses and stores the rows in a project cache. When any member opens the canvas, Gyroscope answers its queries from that cache and queries OWOX live only for what is missing. A member reads cached rows only for Data Marts they can see.

## 2. What the user asked for, and what is assumed

Asked:

1. A Schedules tab in Settings, with the options of Data Mart scheduled triggers: Daily, Weekly with weekdays, Monthly with days of the month, Interval (5, 10, 15, 30 minutes; 1, 2, 3, 4, 6, 8, 12 hours), time, time zone, an enabled switch, and the presets "Weekdays 9:00", "Every hour" and "Every 6 hours".
2. Optional data ranges per schedule. Empty means the member's default range.
3. Each member adds and sees their own schedules.
4. One cache per project, keyed by Data Mart and date range, so members see only data they can access.
5. The backend runs on Cloudflare Workers, for schedules only. The page stays on GitHub Pages.

Assumed:

1. The comparison and week start of each range are taken from the project settings when the schedule is saved: comparison is "previous period" when `comparisonDefault` is on, otherwise off.
2. A schedule takes at most 5 ranges, so a run fits the 300-second action limit.
3. A cached entry is used for the day it was fetched for (its anchor). A newer scheduled run or a manual refresh replaces it.
4. A calculated field of Data Mart X that joins Data Mart Y is cached under X. A member who sees X and not Y reads that value. They can read it in X itself, so this adds no access.

## 3. Platform facts this design rests on

From `@owox/plugin-sdk` 0.42.0 and the OWOX manifest schema:

1. `ctx.schedules` (page) creates, updates, pauses, resumes and deletes cron schedules. Each run starts a backend action as the member who installed the plugin, whoever created the schedule. An installation has at most 20 schedules. A schedule has no creator field.
2. A backend action gets `ctx.owox` (the same `OWOXApiClient` the page gets) and `ctx.collections`, acting as the installer. `timeoutSeconds` is at most 300.
3. A `project` collection with `entityBinding: { type: "data-mart" }` checks every operation against the parent Data Mart: `get` returns null and `list` skips documents whose Data Mart the reader cannot see. Every `put` needs `parentId`.
4. A release cannot add a backend or change collections' scope or binding within a compatibility line, so this ships as 0.4.0.

## 4. Data

### 4.1 `mart-cache` (new)

Project scope, bound to `data-mart` with `SEE` for read, create, update and delete.

1. Document id: `{martId}:{cacheKey}`, where `cacheKey` is the existing `cacheKey(range, compare, weekStart)` from `src/metrics/refresh.ts`. `parentId` is `martId`.
2. Body:

   ```ts
   interface MartCacheDoc {
     v: 1;
     anchor: Day;          // the day the windows were resolved for
     fetchedAt: string;    // ISO time of the newest write
     queries: Record<string, { rows: Record<string, unknown>[]; at: string }>; // key: stable JSON of the traverseData options
   }
   ```

3. The number of documents is bounded by Data Marts × persistable range keys. A new day overwrites the same id.
4. A document over 900,000 characters is not written. Queries are then live for that Data Mart and range.
5. Custom ranges and custom comparisons are never cached, as today.

### 4.2 `schedule-models` (new)

Project scope, bound to `data-mart` with `SEE`.

1. Document id: `{memberId}:{martId}`, `parentId` `martId`.
2. Body: the classes whose `martId` is that Data Mart and the metrics whose `martId` is that Data Mart, plus the model's `builtAt` and `editedAt`.
3. The page writes the snapshot for every Data Mart of the member's model when the member saves a schedule, and again when they save their ontology while they have schedules. On an ontology save, the page also updates the `martIds` parameter of each of the member's schedules.

### 4.3 Existing collections

1. `cache` (member) stays declared and is no longer read or written.
2. `model`, `ontology`, `settings`, `preferences` are unchanged.

## 5. Cache in the page

`src/cache/martCache.ts` wraps an `OwoxLike` for one range key:

1. `traverseData(martId, options)` loads `{martId}:{key}` once per refresh. When its `anchor` is today's anchor and `queries[stableJson(options)]` exists, it returns those rows. Otherwise it calls the real `traverseData`, reads the rows, and records them.
2. `flush()` writes every touched document with `parentId: martId`, merging new queries over the loaded ones. A failed write is reported, not thrown.
3. `mode: 'read-write'` for a normal open; `mode: 'write-only'` for the Refresh button, which skips reads.
4. `stats()` returns the oldest `at` among the hits, which the header shows as "refreshed at".

`App.tsx` stops using `loadCache`, `saveCache` and `isStale`. Every canvas open computes cards through the wrapper. A day already cached costs one `get` per Data Mart and no queries.

## 6. Schedules tab

1. Route `/settings/schedules`, tab label "Schedules", after Checkup.
2. Lists the schedules whose `parameters.memberId` is the current `ctx.userId`: name, cadence in words, ranges, next run, last run status with error code, a pause/resume switch, Edit and Delete.
3. Shows "N of 20 schedules used in this project", because the limit is shared.
4. "Add schedule" opens the form: type (Daily, Weekly, Monthly, Interval), presets, time, weekdays, days of month, interval unit and value, time zone (defaults to the browser zone), enabled, data ranges (multi-select of presets, max 5, empty means the default range), optional name.
5. `src/schedules/cron.ts` builds a cron string from the form and parses one back. A cron the form cannot express opens read-only with its raw text.
6. When `ctx.schedules` is undefined the tab says schedules need a newer OWOX, and nothing else.
7. Errors from `ctx.schedules` show under the form with their `code`, for example `TOO_MANY_SCHEDULES`.

## 7. Backend

1. `worker/index.ts`: `createBackend({ repositoryId: '1297672440', actions: { 'warm-cache': warmCache } })`.
2. `worker/wrangler.toml`: name `gyroscope`, `main = "index.ts"`, a current `compatibility_date`.
3. `plugin.json`:

   ```json
   "backend": {
     "url": "https://gyroscope.<cloudflare-subdomain>.workers.dev",
     "actions": { "warm-cache": { "timeoutSeconds": 300, "input": { ... } } }
   }
   ```

   The input schema: `memberId` (string), `martIds` (array of strings, max 200), `ranges` (array of 1 to 5 `{ range, compare, weekStart }`, with `range.kind` and `compare.kind` limited to `preset`/`off`). It uses no `pattern` or `format`.
4. `warmCache(input, ctx)`:
   1. Validates the input again and throws `INVALID_RANGES` on a mismatch.
   2. Reads `schedule-models/{memberId}:{martId}` for each `martId`. Missing documents are skipped. No document at all throws `MODEL_MISSING`.
   3. Builds a model from the snapshots, then for each range resolves it with `resolveRange` and runs `refreshCanvas` through the cache wrapper in `write-only` mode, then flushes.
   4. Stops starting new ranges when less than 30 seconds remain before `ctx.execution.deadlineAt`.
   5. Returns `{ ranges, marts, queries, skipped }`.
5. The code under `src/metrics`, `src/model`, `src/lib` and `src/cache` is imported by the Worker, so it must not import React or the DOM.
6. Deploy: a `deploy-worker.yml` workflow runs `wrangler deploy` from `worker/` on pushes to `main` that touch `worker/**`, `src/metrics/**`, `src/cache/**`, `src/lib/**` or `src/model/**`. It needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.

## 8. Release

1. `package.json` 0.4.0, `plugin.json` `delivery.url` `https://owox.github.io/gyroscope/v4/`; the manifest test already checks the folder.
2. The backend URL is fixed for the whole 0.4 line. The owner fills in the real `workers.dev` subdomain before the first 0.4 release.
3. README: a Schedules section and the Worker deploy steps.

## 9. Testing

1. `cron.ts`: build and parse round-trip for each type, presets, invalid input.
2. `martCache.ts`: hit, miss, anchor mismatch, write-only mode, flush merge, size limit, `parentId` on put.
3. `warmCache`: fake OWOX and in-memory collections; missing snapshots; deadline cut-off; invalid input.
4. `SchedulesTab`: lists only own schedules, create, edit, pause, delete, error display, no `ctx.schedules`.
5. `App`: a canvas open with a cached day makes no `traverseData` call; Refresh queries live and rewrites.
6. Vitest runs with `--maxWorkers=4`.

## 10. Out of scope

1. Digests or notifications.
2. Caching custom ranges.
3. Cleaning up cache documents of Data Marts that left the model.
