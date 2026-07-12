# Data Mart Dashboards — Design Spec

**Date:** 2026-07-11 (rev. 2026-07-12)
**Deliverable:** an OWOX v2 plugin `data-mart-dashboards` + one enabling backend endpoint.

## 1. Summary

A plugin that turns a Data Mart into an interactive dashboard. It auto-generates a dashboard
from the mart's schema, persists the dashboard configuration as structured metadata, renders
it from that metadata, and lets the user edit it. Dashboards are CRUD-managed; each dashboard
is bound to exactly one Data Mart.

**All aggregation is server-side.** The plugin performs no calculations on the client. Every
component is one query against the Data Mart, requesting a subset of fields plus explicit
aggregations and date buckets.

**Reference implementation:** `/Users/flakss/Projects/report-builder` — copy its
conventions (see §11). This spec deviates from it in one way: report-builder aggregates
client-side because the endpoint below does not exist yet. We add it.

## 2. Repos touched (3)

| # | Repo | Change |
|---|---|---|
| 0 | `owox-data-marts` | **Add `POST /api/data-marts/:id/query`** — a thin REST controller over the existing `QueryDataMartService`. Prerequisite for everything else. |
| 1 | `owox-data-marts-experimental` | `collections` capability stamps the author server-side (`identity.whoami` was deleted). |
| 2 | `data-mart-dashboardization` (this repo) | The plugin. |

## 3. Phase 0 — the enabling endpoint (`owox-data-marts`)

`QueryDataMartService` already does everything required (fields, aggregations, date buckets,
pre/post-join filters, limit, totals) but is wired **only** to the MCP tool `query_data_mart`
(`POST /mcp`, JSON-RPC). The plugin broker's path allowlist does not permit `/mcp`, so no
plugin can reach it. Everything else is already pre-wired for a REST endpoint:

- The broker allowlists any sub-path under `/api/data-marts/*` and forwards an arbitrary JSON body.
- `owoxAction()` already maps `POST …/query` → **`view`** grant (not `create`).
- `report-builder` already declares the `QueryRequest`/`QueryResult` types for it.

**Add:** `POST /api/data-marts/:id/query`, delegating to `QueryDataMartService.run`.

Request:
```ts
{
  fields: string[]                       // required, min 1
  aggregations?: { field, function }[]   // SUM|COUNT|COUNT_DISTINCT|AVG|MIN|MAX|P25|P50|P75|P95
  date_buckets?: { field, unit, time_zone? }[]  // DAY|WEEK|MONTH|QUARTER|YEAR
  slices?:  { field, operator, value? }[]  // pre-join
  filters?: { field, operator, value? }[]  // post-join
  limit?: number                           // 1..1000, default 20
}
```
Response (JSON — not the MCP TSV):
```ts
{ columns: string[], rows: unknown[][], totals: Record<string, unknown> | null,
  returnedRows: number, truncated: boolean }
```

**Semantics inherited from the service (do not re-derive):**
- **Grouping is implied.** A projected field *with* an aggregation is a metric; a projected field
  *without* one is a GROUP BY key. **No `aggregations` ⇒ no GROUP BY ⇒ raw rows.**
- Every field named in `aggregations`/`date_buckets` **must also appear in `fields`**, else
  `AGGREGATION_COLUMN_NOT_SELECTED` / `DATE_TRUNC_COLUMN_NOT_SELECTED`.
- Aggregated output columns are labelled `"<field> | <TOKEN>"` (e.g. `revenue | SUM`; P50 → `MEDIAN`).
  A `COUNT(*) AS "Row Count"` column is auto-appended to any aggregated plan.
- A field may only use a function in its `allowedAggregations` (governance) — else
  `AGGREGATION_FUNCTION_NOT_ALLOWED_FOR_FIELD`.
- **`totals` is a separate ungrouped query over all matching rows, ignoring `limit`.** This is what
  scorecards read.

**Accepted limits (v1 scopes to these):**
- No `HOUR` bucket (DAY is the finest grain).
- Operators `in`, `not_in`, `in_next_n_days`, `this_week` are **rejected** by the service →
  no multi-select dimension filters, no "this week" preset in v1.
- **No offset/pagination**; `limit` ≤ 1000. Tables are limit-only.

## 4. Phase 1 — author stamping (`owox-data-marts-experimental`)

`identity.whoami` and the `storage` KV were **removed** from the plugin surface (commit `7883437`)
— a plugin can no longer learn the user id. The dashboard spec requires an **Author**.

**Change:** the `collections` capability stamps the acting user onto the doc server-side on `put`
(the broker already holds `userId` in `CapabilityContext`). The plugin never sees an identity; it
never sees authorship at all: the host stamps it on write and strips it on read (see plan Task 2). This preserves the privacy decision that
motivated the removal.

## 5. Persistence — `collections('dashboards')`

One JSON document per dashboard. Declared in the manifest:

```jsonc
"collections": [{ "name": "dashboards", "scope": "project" }]
```

**Access control is free.** A collection doc may carry a reserved
`$entity: { type: 'data-mart', id }`, which makes the doc **inherit that data mart's ACL** —
`list()` returns only docs whose `$entity` the acting user can view; `get()` on an inaccessible
doc reads as absent. Setting `$entity` to the linked mart therefore satisfies *"dashboards must be
shown only for data marts accessible for the user"* with **zero authz code**, and structurally
enforces one-mart-per-dashboard.

Store: flat JSON file per collection, whole-file read/rewrite. **Ceiling: ~10k small docs** — far
beyond any realistic dashboard count.

## 6. The dashboard document

```ts
Dashboard = {
  id: string                    // crypto.randomUUID()
  $entity: { type: 'data-mart', id: dataMartId }   // ACL binding — the ONE mart
  name: string
  $createdAt, $updatedAt        // stamped server-side; $createdBy is stamped but NEVER returned to the plugin (§4)
  createdAt, updatedAt          // ISO; updatedAt bumped on every save
  gridColumns: number           // default 5, adjustable in settings
  filters: FilterRule[]         // GLOBAL, applied to every component
  slices:  FilterRule[]         // GLOBAL, pre-join
  components: Component[]       // ordered
  configVersion: number         // optimistic-concurrency stamp AND refetch key (§9)
  generatedAt?: string          // provenance for "restore generated layout"
}

Component = {
  id: string
  type: 'scorecard' | 'timeseries' | 'bar' | 'pie' | 'donut' | 'table'
  title: string
  description?: string
  width: number     // 1..gridColumns  (20/40/60/80/100% at gridColumns=5)
  height: number    // row units, default 1
  config: <per-type>
}

FilterRule = { field, operator, value?, placement?: 'pre-join' | 'post-join' }
```

**Filters and slices are global only.** There are no component-level filter overrides — every
component receives the same `filters`/`slices`. (Explicit product decision.)

Per-type `config` is a **query spec** — it compiles directly to a §3 request:

| Type | config | → query |
|---|---|---|
| `scorecard` | `metric, aggregation, format, comparePrevious?` | `fields:[metric]`, `aggregations:[{metric,agg}]` → read `totals` |
| `timeseries` | `dateField, metric, aggregation, unit, breakdown?, sort` | `fields:[dateField,metric,(breakdown)]`, `aggregations:[{metric,agg}]`, `date_buckets:[{dateField,unit}]` |
| `bar` | `dimension, metric, aggregation, orientation, sort, limit, breakdown?` | `fields:[dimension,metric]`, `aggregations:[{metric,agg}]`, `limit` |
| `pie`/`donut` | `dimension, metric, aggregation, maxCategories, sort` | same as bar, `limit: maxCategories` |
| `table` | `columns[], sort, limit, format` | `fields: columns`, no aggregations → raw rows |

`aggregation` must be within the field's `allowedAggregations`.

## 7. Auto-generation

**Inputs** (all server-side, no client math):
- `GET /api/data-marts/:id` → `schema.fields[]` with `name, type, aggregationRole ('dimension'|'metric'),
  allowedAggregations[]` — the field picker source.
- `GET /api/data-marts/:id/blendable-schema` → joined fields (`<alias>__<field>`, `aggregateFunction`).
- **Cardinality probe** for pie-vs-bar: one query per candidate dimension —
  `fields:[dim]`, `aggregations:[{field: dim, function:'COUNT'}]`, `limit: 20`; a dimension with
  ≤ 8 groups is pie-eligible, otherwise bar/table. (This is the "data sampling" step; it is a
  server-side aggregation, not a client calculation.)

**Generated order** (the spec's Default Dashboard Structure):
1. Title + metadata.
2. Global date filters — one per DATE/DATETIME/TIMESTAMP field.
3. Up to 5 scorecards — top `aggregationRole:'metric'` fields.
4. Time-series per primary date field (unit = DAY).
5. Bar charts for informative dimension×metric pairs.
6. Pie/donut **only** for dimensions with ≤ 8 distinct values (high-cardinality → bar/table).
7. Detailed table.

Deterministic given (schema, probes). `generatedAt` enables "restore generated layout".

## 8. Layout

- CSS grid, `gridColumns` wide (default 5). `width` = column span, `height` = row span. No arbitrary
  widths. Responsive: collapses to full width on narrow screens, preserving order.
- Page chrome is **mandatory and verbatim**: `dm-page > dm-page-header(+title) > dm-page-content >
  dm-card`. Do **not** rebuild the card from Tailwind utilities — the host compiles plugin CSS with
  the **default** Tailwind theme (`rounded-md`=6px, no `bg-muted`/`text-foreground` tokens), so
  utilities render subtly wrong inside the iframe. Copy the `.dm-*` block from
  `plugin-starter/ui/styles.css`.
- **CSS is precompiled and committed** (`styles.src.css` → `styles.css`), because the host ignores
  `tailwind.config` and won't resolve shadcn tokens (`--background`, `--chart-1..5`, `.dark`).

## 9. Data fetching, loading & interactivity

- **One query per component**, issued via `owox.request('POST', '/api/data-marts/{id}/query', body)`.
  Grant: `{ type: 'data-mart', scope: 'all', actions: ['view'] }` (POST `…/query` → `view`).
- **Refetch key = `configVersion`.** Any edit or filter change bumps it, debounced **1s**.
- **Per-component loading/stale states** — copy `report-builder/ui/lib/freshness.ts#useLayerData`:
  `idle | loading | stale | ready`. While refetching, the component shows its last-good data at 50%
  opacity with a progress line ("preload"), never a blank flash. Offscreen/collapsed components skip
  the network and go `stale`.
- **Cross-filtering:** clicking a bar/slice appends a global `{field, operator:'eq', value}` filter
  and bumps `configVersion` — every component refetches. Hover tooltips and legend toggles are local
  to the chart (presentation only, no recomputation).

## 10. Charts

**recharts** wrapped in the **shadcn chart** component (`ui/components/ui/chart.tsx` — copy from
report-builder), colors `var(--chart-1..5)`. Tables use shadcn table. `recharts` goes in
`dependencies` (the host installs real deps; shared deps stay external).

## 11. Module layout

```
plugin.json                     # manifest: data-mart view grant + collections decl
ui/
  index.html main.tsx App.tsx
  styles.src.css  styles.css    # source + PRECOMPILED committed output
  sdk-mock.ts                   # local SDK mock for `npm run dev` / vitest
  lib/
    api.ts        # owox.request wrappers: listMarts, getMartDetail, getBlendableSchema, queryDataMart
    types.ts      # Dashboard doc, Component, FilterRule, QueryRequest/QueryResult
    dashboards.ts # collections('dashboards') CRUD; $entity binding
    compile.ts    # Component.config + global filters -> QueryRequest   (the core mapping)
    generate.ts   # schema + cardinality probes -> Dashboard doc
    filterOps.ts  # type-aware operator catalog + relative-date presets
    freshness.ts  # useLayerData: loading/stale/refresh, 1s debounce
    format.ts     # number/date formatting (presentation only)
  components/
    DashboardList.tsx  DashboardView.tsx  Grid.tsx  FilterBar.tsx
    Scorecard.tsx  TimeSeriesChart.tsx  BarChart.tsx  PieChart.tsx  DataTable.tsx
    editors/*
  components/ui/  # shadcn: chart, table, select, popover, sheet, ...
```

`compile.ts` is the heart: a pure `(component, globalFilters, globalSlices) → QueryRequest`.
It is the only place that knows the query API, and it is fully unit-testable without React.

No `backend.ts` in v1 (production backend execution is pending the WASM sandbox). Assistant tools
are deferred.

## 12. Phased plan

0. **`POST /api/data-marts/:id/query`** in `owox-data-marts` (+ e2e test). *Blocks everything.*
1. **Author stamping** in the experimental host's `collections` capability.
2. **Plugin skeleton + CRUD** — scaffold from `plugin-starter`; manifest; mart picker;
   `collections('dashboards')` list/create/duplicate/delete with `$entity`; `dm-*` chrome.
3. **Data layer** — `api.ts`, `types.ts`, `compile.ts`, `filterOps.ts`, `freshness.ts` (unit-tested).
4. **Auto-generator** — `generate.ts` (schema + cardinality probes → doc).
5. **Renderer + grid + global filters** — Grid (width/height), FilterBar, Scorecard (from `totals`),
   DataTable. End-to-end generated dashboard responding to filters.
6. **Charts** — recharts timeseries/bar/pie-donut + per-component loading/stale.
7. **Editing** — add/remove/duplicate/move/resize(w+h)/retype, config panels, restore generated layout.
8. **Interactivity polish** — cross-filtering, legend toggles, reset.

## 13. Testing & verification

- **Unit (vitest):** `compile.ts` (every component type → expected QueryRequest), `generate.ts`,
  `filterOps.ts`, `format.ts`, `freshness.ts`. Run with `--maxWorkers=4`.
- **Component:** renderers against fixture `QueryResult`s; loading/stale states.
- **Host build probe** (AGENTS.md §7.1) before publishing — confirm recharts + precompiled CSS
  bundle with no unresolved imports.
- **Dev:** `npm run dev` (mock SDK) → `npm run dev:broker` with a gitignored `owox.dev.json`
  pointing at a backend that has the §3 endpoint → embedded host install (required pre-release).

## 14. Out of scope (v1)

`backend.ts` / assistant tools; AI-assisted generation; multi-select (`in`) filters, `HOUR` grain,
and table pagination (all blocked on §3 limits); dashboard sharing independent of the mart.

## 15. Tracked debt

- No `HOUR` granularity; no `in`/`not_in`; no `this_week`; no offset pagination; `limit` ≤ 1000.
  Each is a one-line unblock in the query service — revisit after v1.
- shadcn-chart theming under the host's default-Tailwind build must be verified in phase 6, not assumed.
