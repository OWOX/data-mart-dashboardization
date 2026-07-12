# Data Mart Dashboards — Design Spec

**Date:** 2026-07-11
**Target:** OWOX Data Marts (experimental) — v2 plugin architecture
**Deliverable:** an installable plugin `data-mart-dashboards`

## 1. Summary

A plugin that turns any Data Mart into an interactive dashboard. It auto-generates a
sensible dashboard from the mart's schema and a data sample, persists the dashboard
configuration as structured metadata, renders it from that metadata, and lets the user
edit it. Dashboards are CRUD-managed like plugins/credentials, and each dashboard is
bound to exactly one Data Mart.

This is **not** a backend feature in the `owox-data-marts` monorepo. It is a v2 plugin: a
folder (`plugin.json` + `ui/`) that the host builds and sandboxes. It uses only the
capability SDK — no ambient authority, no embedded DB.

## 2. Platform constraints (these shape everything)

The v2 plugin contract (`owox-data-marts-experimental/AGENTS.md`) and SDK
(`packages/plugin-sdk`) impose hard limits. The design is built around them, not against
them.

1. **Persistence = `collections(name)` SDK capability.** `collections('dashboards')`
   exposes `list() / get(id) / put(id, doc) / delete(id)`, host-owned, scoped to
   `(project, plugin)`, no grant needed. This is the "KV collection" / "collections
   service with persistent storage." One document per dashboard.

2. **Data access = `owox.dataMart(id).query()` only.** Resolves to `GET
   /api/data-marts/{id}/run`. It takes **no arguments** and returns the mart's **full
   result rows**. There is **no** SQL / filter / group-by / granularity pushdown.

3. **No production backend.** `backend.ts` runs only in the dev runner
   (`npm run dev:broker`), not on the real host (pending the WASM sandbox). The core flow
   must therefore be **frontend-only**. No `backend.ts` in v1.

4. **Access control is free.** The manifest declares
   `{ "type": "data-mart", "scope": "all", "actions": ["view"] }`. The broker enforces
   that the user can only list/read Data Marts they already have access to. Requirement
   "dashboards shown only for accessible data marts" is satisfied by the broker — the
   plugin adds no authz code.

5. **Host build = esbuild + default Tailwind theme** (AGENTS.md §7.1). The host ignores
   `tailwind.config`. Custom theme tokens / plugins are NOT applied. CSS that needs a
   custom theme must be **precompiled and committed**. Runtime deps must be in
   `dependencies` (not `devDependencies`). `@owox/plugin-sdk`, `react*`, `react-router-dom`
   are host-provided — keep them external, never bundle.

### Consequences (accepted design basis)

- **All aggregation is client-side.** Every filter, group-by, date-truncation,
  aggregation, sort, and limit in this spec is computed **in the browser** over the rows
  `query()` returns. The Data Mart's `/run` output **is** the dataset.
  - **Ceiling:** bounded by row volume — appropriate when the mart is the pre-shaped
    result (hundreds → low thousands of rows). Not for aggregating millions of rows live.
  - **Upgrade path:** if the host later ships query pushdown or prod backend execution,
    replace the aggregation layer only; the config data model is unchanged.
  - Precedent: `packages/odm-usage-stat` already works exactly this way
    (`ui/lib/runs.ts`: `applyFilters` / `distinctValues` / bucketing in JS).

- **Charts = shadcn chart component (recharts).** Chosen by the user. The design system
  ships no chart primitives. Because the host uses the default Tailwind theme, the shadcn
  chart's theme CSS must be **precompiled/committed** (§7.1) and chart colors set via
  explicit values or inline CSS vars, not custom Tailwind tokens. `recharts` goes in
  `dependencies`. **Tracked risk:** the shadcn chart CSS-variable theming must be verified
  against the host's default-Tailwind build (reproduce the esbuild probe from AGENTS.md
  §7.1 before publishing). Everything else (layout, filters, tables, controls) uses shadcn
  + the `.dm-*` classes from `packages/plugin-starter/ui/styles.css`.

## 3. Data model (the dashboard document)

Stored as one JSON document per dashboard via `collections('dashboards').put(id, doc)`.
Validated with a Zod schema in `ui/lib/schema.ts`. This is the "structured metadata, not
hard-coded UI" principle.

```ts
Dashboard = {
  id: string                 // uuid (crypto.randomUUID)
  name: string
  author: string             // from identity.whoami() at creation
  dataMartId: string         // the ONE mart this dashboard is bound to
  createdAt: string          // ISO
  updatedAt: string          // ISO — bumped on every saved change
  gridColumns: number        // default 5, adjustable in settings
  globalFilters: FilterNode  // AND/OR tree (see §5)
  components: Component[]     // ordered; render order == array order
  generatedFrom?: {          // provenance, enables "restore generated layout"
    schemaHash: string
    generatedAt: string
  }
}

Component = {
  id: string
  type: 'scorecard' | 'timeseries' | 'bar' | 'pie' | 'donut' | 'table'
  title: string
  description?: string
  width: 1 | 2 | 3 | 4 | 5   // columns; % = width/gridColumns
  config: ScorecardConfig | TimeSeriesConfig | BarConfig | PieConfig | TableConfig
  filterOverrides?: FilterNode  // replaces/extends global filters for this component
}
```

Per-type config (all reference fields by mart column name):

- **ScorecardConfig**: `metric`, `aggregation`, `numberFormat`, `comparePreviousPeriod: bool`.
- **TimeSeriesConfig**: `dateField`, `metric`, `aggregation`, `granularity`
  (`hour|day|week|month|quarter|year`), `breakdown?`, `sort`, `nullHandling`.
- **BarConfig**: `dimension`, `metric`, `aggregation`, `orientation`
  (`vertical|horizontal`), `sort`, `limit`, `secondaryMetric?`, `breakdown?`.
- **PieConfig** (pie/donut): `dimension`, `metric`, `aggregation`, `maxCategories`, `sort`,
  `otherBucket: bool`.
- **TableConfig**: `columns[]` (order + visibility), `sort`, `pageSize`, `search: bool`,
  `columnFilters?`, `formatting`, `conditionalFormatting?`, `totals?`.

`aggregation ∈ sum | avg | min | max | count | count_distinct`.
`numberFormat` = a small formatting descriptor (decimals, prefix/suffix, thousands,
percent). Formatting logic lives in `ui/lib/format.ts`.

## 4. Field classification & auto-generation (`ui/lib/classify.ts`, `generate.ts`)

**Inputs:** the mart schema (`owox.request('GET', '/api/data-marts/{id}')` → `schema`)
and a data sample (one `query()` call; profile the returned rows).

**Classify** each field into a role:
- `date` — DATE / DATETIME / TIMESTAMP / TIME types.
- `metric` — numeric types (INTEGER/FLOAT/NUMERIC…).
- `dimension` — string/boolean types.
- Per dimension, compute **cardinality** from the sample (distinct count) to decide
  pie-vs-bar and default limits. Also compute min/max (dates → default range) and null
  rate (metrics → default agg, null handling).

**Generate** a default Dashboard doc in this order (spec's Default Dashboard Structure):
1. Title + metadata (name defaults to mart title).
2. Global date filters — one per date/datetime/timestamp field, default preset "Last 30
   days" (or full range if data is older).
3. Up to 5 scorecards — top numeric metrics (by field order / non-null density).
4. One time-series chart per primary date field (metric = top scorecard metric,
   granularity = day).
5. Bar charts for the most informative dimension×metric pairs (low-to-moderate
   cardinality dimensions).
6. Pie/donut only for **low-cardinality** dimensions (≤ ~8 distinct); higher cardinality
   → bar or table. (Explicit spec correction.)
7. One detailed table over all columns.

Generation is deterministic given (schema, sample). `generatedFrom.schemaHash` records
provenance so "Restore generated layout" can regenerate.

## 5. Filter engine (`ui/lib/filter.ts`)

A pure function `applies(row, node): boolean` over a filter tree.

```ts
FilterNode = { op: 'and' | 'or', children: (FilterNode | Condition)[] }
Condition  = { field, operator, value | value2 | values | relative }
```

Operators: `eq, neq, in, notIn, gt, gte, lt, lte, between, contains, startsWith,
endsWith, isNull, isNotNull`, plus **relative date** conditions (presets below).
Global `globalFilters` apply to every component whose fields are compatible; a component's
`filterOverrides` replace the global tree for that component.

**Date presets** (`ui/lib/date-presets.ts`, model after `odm-usage-stat`): Today,
Yesterday, Last 7/30 days, This/Last week, This/Last month, This/Last year, Custom range.
Interaction model ≈ Looker Studio date-range control.

## 6. Aggregation (`ui/lib/aggregate.ts`)

Pure functions over filtered rows:
- `groupBy(rows, dimField)` → buckets.
- `dateTrunc(value, granularity)` → bucket key (hour…year).
- `aggregate(values, fn)` → number.
- `sortLimit(results, sort, limit)`.
- `otherBucket(results, maxCategories)` for pie charts.

Each component's data pipeline: `rows → filter(global ⊕ overrides) → group → aggregate →
sort → limit → format`. All pure, all unit-tested independent of React.

## 7. Rendering & layout (`ui/components/`)

- **Grid** — `gridColumns`-wide responsive grid (default 5). Component `width` maps to a
  column span (20/40/60/80/100%). On narrow screens, columns collapse to full width while
  preserving component order. Uses shadcn + `.dm-*` classes + CSS grid (no arbitrary
  widths).
- **Page chrome** — every screen wraps in `dm-page > dm-page-header + dm-page-content >
  dm-card` (AGENTS.md requirement; skipping the header = no title).
- **DateFilterBar** — global date filters in one horizontal row (wrap on narrow),
  each labeled with its mart field.
- **Component renderers** — `Scorecard`, `TimeSeriesChart`, `BarChart`, `PieChart`,
  `DataTable`. Charts use recharts (shadcn chart); scorecard/table use shadcn.
- **DashboardView** — reads the doc, holds filter state, computes each component's data via
  the lib functions, renders the grid. Filter changes re-run the pure pipeline (memoized).

## 8. CRUD & routing (`ui/model/`, `ui/App.tsx`)

- **DashboardList** — `collections('dashboards').list()`; shows name, mart, author, dates;
  create / open / duplicate / delete. "New" flow: pick a Data Mart (from
  `owox.request('GET', '/api/data-marts')`, already access-filtered by the broker) →
  auto-generate → save → open.
- **Routing** — react-router: `/` list, `/d/:id` view, `/d/:id/edit` edit (or an edit
  toggle within view). react-router-dom is host-provided (external).
- Every save `put`s the doc with a bumped `updatedAt`.

## 9. Editing (§ Dashboard Editing)

Add / remove / duplicate / move (reorder) / resize (1–5 cols) / change type / pick
dimensions+metrics / configure aggregation, sort, filters / edit title+description /
**restore generated layout**. Editing mutates the in-memory doc; save persists. Config
panels are shadcn forms (sheet/drawer per component).

## 10. Interactivity (§ Dashboard Interactivity)

Global date + dimension + metric filters; reset; hover tooltips; legend series toggle;
component-level overrides. **Cross-filtering** (click a bar/slice → optionally filter
other components) and **drill-down** are included but sequenced last (phase 7) since they
touch shared filter state.

## 11. Module layout

```
plugin.json
ui/
  index.html  main.tsx  styles.css        # entry; precompiled CSS (§7.1)
  App.tsx                                  # routes
  lib/
    schema.ts        # Zod dashboard doc + config types
    classify.ts      # field roles + cardinality/profile
    generate.ts      # schema+sample -> Dashboard doc
    filter.ts        # filter tree evaluation (15 operators + relative dates)
    aggregate.ts     # group/agg/date-trunc/sort/limit/other-bucket
    date-presets.ts  # Looker-style presets
    format.ts        # number/date formatting
    query.ts         # owox.dataMart(id).query() wrapper + mart list/schema fetch
  model/
    dashboards.ts    # collections('dashboards') CRUD
    state.ts         # dashboard view/edit state (reducer)
  components/
    DashboardList.tsx  DashboardView.tsx  Grid.tsx  DateFilterBar.tsx
    Scorecard.tsx  TimeSeriesChart.tsx  BarChart.tsx  PieChart.tsx  DataTable.tsx
    editors/*        # per-component config panels
```

Logic lives in pure `lib/` functions (unit-tested with vitest, the starter's test setup);
components stay thin.

## 12. Phased implementation plan

Each phase is independently testable; pure `lib/` functions carry the logic.

1. **Skeleton + CRUD** — scaffold from `plugin-starter`; manifest with `data-mart`
   credential; mart picker; `collections('dashboards')` CRUD list; empty dashboard shell
   in `dm-*` chrome. *(No aggregation yet.)*
2. **Data layer** — `query.ts` + `classify.ts` + `filter.ts` + `aggregate.ts` +
   `date-presets.ts` + `format.ts` as pure, fully unit-tested functions.
3. **Auto-generator** — `generate.ts`: schema + sample → default Dashboard doc.
4. **Renderer + grid** — Grid, DateFilterBar, Scorecard, DataTable; end-to-end view of a
   generated dashboard responding to date filters.
5. **Charts** — recharts timeseries / bar / pie-donut wired to the filter+aggregate
   pipeline. Verify shadcn chart CSS against the host build (§7.1 probe).
6. **Editing** — add/remove/duplicate/move/resize/retype + config panels + "restore
   generated layout"; save bumps `updatedAt`.
7. **Interactivity polish** — cross-filtering, drill-down, legend toggles, component
   filter overrides, reset.

## 13. Testing & verification

- **Unit (vitest):** every `lib/` function — classify, filter (all 15 operators + relative
  dates), aggregate (each agg fn + date-trunc granularities), generate (schema+sample →
  expected doc shape), format, date-presets. Mirror `odm-usage-stat`'s test layout.
- **Component (@testing-library/react):** renderers with fixture rows; filter interaction
  updates output.
- **Host build check:** run the AGENTS.md §7.1 esbuild probe before publishing; confirm
  recharts + precompiled CSS resolve with no unresolved imports.
- **Dev loop:** `npm run dev` (mock SDK) for UI; `npm run dev:broker` with `owox.dev.json`
  for live `owox`/`collections`; Step 4 embedded host install before release.
- Run vitest capped at `--maxWorkers=4` (hardware constraint).

## 14. Out of scope (v1)

- `backend.ts` / assistant tools (blocked on prod WASM sandbox).
- Query pushdown / server-side aggregation (no SDK surface).
- AI-assisted generation (deferred; config model already supports dropping it in).
- Dashboard sharing independent of the mart (access derives from the mart by design).

## 15. Open ceilings (documented shortcuts)

- Row-volume ceiling on client-side aggregation (§2). Revisit if marts exceed ~low
  thousands of rows; upgrade path = query pushdown / prod backend.
- shadcn-chart theming under host default-Tailwind is a build risk to verify early
  (phase 5), not assume.
