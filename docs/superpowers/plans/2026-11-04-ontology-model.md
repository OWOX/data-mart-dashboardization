# Ontology Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Each member owns an editable ontology model, stored in plugin storage. It starts from the project model (filtered to the member's access) or is built automatically with visible progress. It is edited in a new Settings tab, updated by Rebuild only through a confirmed before / after proposal, and survives deleted Data Marts and fields with warnings instead of errors.

**Architecture:** `Model` goes to `version: 2` and gains `shown` flags, optional forecast sources and `editedAt`. It lives in a new member collection, `ontology`. Pure modules do the new logic: `upgrade` (v1 to v2), `seedFrom` (project model filtered by access), `checkHealth` (broken references) and `diffModels`/`applyChanges` (rebuild proposal). App and Settings consume them. Refresh skips broken references, and a query that fails mid-refresh degrades to `—`.

**Tech Stack:** React 19, TypeScript, Vite, Vitest 4 + happy-dom + Testing Library, lucide-react, `@owox/plugin-sdk` 0.39. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-04-ontology-model-design.md` (binding).

## Global Constraints

- Run tests with `npx vitest run --maxWorkers=4` only. Typecheck with `npx tsc --noEmit -p .`. Both must be clean before each commit.
- Use only the style tokens in `src/styles.css`, in light and dark. Keyboard focus must be visible (`outline: none; box-shadow: 0 0 0 2px var(--primary)`), and every control needs an accessible name.
- Match the surrounding code: terse, comments only for the why, no new dependencies.
- No crash and no error screen may come from a missing Data Mart, a missing field or a failed query. Show a warning in place.
- Commit after each task with a message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Seeding: a member who can access only some Data Marts gets only those classes, plus the goal class (shown as no access), and no edges or metrics pointing at dropped classes.
2. A Data Mart deleted after it was put in the model: a warning on the card and a banner. The refresh carries on for the other metrics.
3. A field renamed in a schema (fact, plan, forecast or date field): only that metric or part degrades. The Ontology tab flags it and keeps the old name.
4. Rebuild with nothing selected, or Discard: the stored model is byte-for-byte unchanged.
5. An edit saved in the Ontology tab invalidates the member's cached numbers (`editedAt` is part of staleness), and hidden classes and metrics are neither queried nor drawn.

---

### Task 1: Model v2, member storage and seeding

**Files:** `src/types.ts`, `src/store/collections.ts`, new `src/model/upgrade.ts`, new `src/model/seed.ts`, `src/App.tsx`, `src/metrics/refresh.ts`, `src/ui/Canvas.tsx`, `src/ui/Card.tsx` (hidden metrics only), `plugin.json`, `package.json` (version `0.3.0`), tests next to each.

**Produces:**
```ts
// types.ts
export interface ForecastDef { martId: string; measure: Measure; dateField: string }
// MetricDef: + shown: boolean; + forecast: ForecastDef | null
// ClassNode: + shown: boolean
// Model: version: 2; + editedAt: string | null
// CacheDoc: + editedAt: string | null
// model/upgrade.ts
export function upgradeModel(raw: unknown): Model | null;   // v1 → v2 (shown true, forecast null, editedAt null); v2 validated; anything else null
// model/seed.ts
export function seedFrom(project: Model, accessible: ReadonlySet<string>): Model; // keeps classes whose martId is accessible, plus the goal class; drops their edges/metrics; recomputes nothing else
// store/collections.ts
export const loadOntology: (ctx) => Promise<Model | null>;  // 'ontology' / 'current', through upgradeModel
export const saveOntology: (ctx, m: Model) => Promise<void>;
export const loadProjectModel: (ctx) => Promise<Model | null>; // the old project 'model' doc, read-only, through upgradeModel
// isStale also compares doc.editedAt with model.editedAt
```

- `plugin.json` adds `{ "name": "ontology", "scope": "member" }` and keeps `model` (project).
- App load order: `loadOntology`, otherwise `loadProjectModel`, then `seedFrom(project, ids from owox.dataMarts.list)` saved with `saveOntology`, otherwise build. For now the build path is the existing intro and build flow; Task 2 makes it automatic. Every save the App does goes to `ontology`. Nothing writes `model` any more.
- `buildModel` returns v2 (`shown: true`, `forecast: null`, `editedAt: null`).
- Hidden classes (`shown: false`) are dropped from the canvas the way access-hidden classes already are. The goal class is always drawn. Hidden metrics are dropped from `metricIds` for querying and rendering. A hidden key metric falls back to the first shown metric, or to no key.
- Tests:
  1. upgrade from v1, plus rejection of junk;
  2. seed filtering, with a partial-access fixture where the goal class is inaccessible;
  3. the load order, as an App test: ontology doc, project seed, nothing;
  4. a hidden class and a hidden metric are not queried;
  5. `isStale` with `editedAt`.

### Task 2: Automatic build with progress

**Files:** `src/model/build.ts`, `src/App.tsx`, new `src/ui/BuildProgress.tsx`, `src/styles.css`, tests.

**Produces:**
```ts
export type BuildStep =
  | { kind: 'read'; what: 'project' | 'contexts' | 'marts' | 'ai'; done: number; total: number | null; finished: boolean }
  | { kind: 'found'; goal: string | null; classes: string[]; metrics: number };
// buildModel(args & { onStep?: (s: BuildStep) => void })
export function BuildProgress({ steps }: { steps: BuildStep[] }): JSX.Element;
```

- With no ontology doc and no project model, App starts the build on open with no intro click. The intro view goes away. When AI isn't configured, the existing blocked screen shows.
- The BuildProgress page has the LoadingLine at the top, determinate during "Data Marts N of M", and two columns: "Reading" and "Found". On small screens the columns stack.
- Reading rows: "Project description", "Contexts: N", "Data Marts: N of M", "AI reading descriptions…". Each row gets a ✓ when finished.
- Found rows: "Goal: <metric> (<class>)", "Classes: N (first 3 titles, …)", "Metrics: N". They fill in when the AI and validation finish.
- The same component is reused by Rebuild in Task 6.
- Tests:
  1. `onStep` order, with fake owox and generate;
  2. BuildProgress renders the rows and the determinate line;
  3. App opens straight into the build with no model.

### Task 3: Health check; deleted Data Marts and fields degrade to warnings

**Files:** new `src/model/health.ts`, `src/metrics/refresh.ts`, `src/metrics/compute.ts`, `src/App.tsx`, `src/ui/Card.tsx`, `src/ui/Badge.tsx`, `src/ui/Canvas.tsx`, `src/types.ts`, tests.

**Produces:**
```ts
export type IssueKind = 'mart_missing' | 'fact_field_missing' | 'date_field_missing' | 'plan_mart_missing' | 'plan_field_missing' | 'forecast_mart_missing' | 'forecast_field_missing';
export interface Issue { kind: IssueKind; classId: string; metricId: string | null; text: string } // text e.g. 'Field revenue no longer exists in Orders'
export async function checkHealth(owox: OwoxLike, model: Model, accessible: ReadonlySet<string>): Promise<Issue[]>; // fetches details of referenced marts (pool 6); a fetch that fails = mart_missing; never throws
// MetricResult: + warning?: string | null
```

- App runs `checkHealth` after `fetchInputs`, using the Data Mart list ids, and keeps the issues in state.
- `refreshCanvas` gets `issues: Issue[]`:
  1. A metric with `fact_field_missing`, `date_field_missing` or `mart_missing` isn't queried. Its result is `{ fact: null, …, status: 'neutral', warning: text }`.
  2. A plan issue drops the plan, and a forecast issue drops the forecast source, falling back to extrapolation. Both set `warning`.
- A `computeMetric` that rejects mid-refresh produces a result with `warning: describeError(e)`. Today a rejection leaves the metric absent; after this change it is always present. The run carries on.
- Card and badge with a `warning` show a lucide `TriangleAlert` icon (`aria-label="Warning"`), and the text goes into the info tooltip.
- A class with `mart_missing` renders like the no-access card, with the text "Data Mart not found".
- A one-line banner above the bands reads "N references in the model are broken. Review in Ontology Model". It opens Settings on the Ontology tab once Task 5 lands. Until then it opens Settings.
- Tests:
  1. each issue kind from a fake schema;
  2. `checkHealth` with a details fetch that rejects;
  3. refresh skips the broken metric and keeps the others;
  4. a traverse that throws `Not found` mid-refresh gives a warning, not a missing card;
  5. the banner count.

### Task 4: Forecast from a source

**Files:** `src/metrics/compute.ts`, `src/metrics/query.ts` if needed, tests.

- When `metric.forecast` is set and has no issue, the forecast value is the forecast measure over the range: the total from range start to range end for a `flow`, or the value on the range's last day for a `level` (use the existing `levelAt` on a daily series). The spark's forecast part is the forecast field's daily values from the day after the anchor to range end.
- Status still uses the forecast while the range runs, as today.
- If the forecast query rejects, fall back to extrapolation and set `warning: 'Forecast source failed: …'`.
- Tests:
  1. flow and level forecast from a source;
  2. fallback on reject;
  3. `forecast: null` keeps today's numbers. Check this by snapshotting an existing compute test's output.

### Task 5: Settings tabs and the Ontology Model editor

**Files:** `src/ui/SettingsPage.tsx`, new `src/ui/OntologyTab.tsx`, new `src/ui/FieldPicker.tsx`, `src/App.tsx`, `src/styles.css`, tests.

- Tabs: General (today's fields, minus the Model card) and Ontology Model. They use `role="tablist"` with arrow keys. The routes are `/settings` and `/settings/ontology`, through `ctx.ui.setRoute`, and App reads `ctx.route` on start so a reload lands on the right tab or the canvas.
- Ontology tab:
  1. Classes in canvas order, goal first. Each class row has a checkbox for shown (disabled for the goal, with title "The goal is always shown"), the title and the context names.
  2. Each metric row has: a shown checkbox; a key-metric radio per class; the name as a text input; the role as a select; Fact (field select from the class mart's schema, aggregation select with "Calculated" for `fn: null`, date field select with "No date (all time)"); Plan ("None" or Data Mart select → field, aggregation, date field, shape); Forecast ("Extrapolated" or Data Mart select → field, aggregation, date field).
  3. Field lists come from the details `checkHealth` already fetched. Pass a `details: Map<string, MartDetail>` down; fetch others on demand when a new Data Mart is chosen.
  4. A reference with an Issue is shown in red with the old value kept as a disabled option ("revenue (missing)").
- The draft is kept in component state. **Save** validates (every shown class has a key metric, or none if it has no shown metrics), sets `editedAt = now`, calls `saveOntology`, and returns to the canvas, which refreshes. **Cancel** discards the draft.
- "Rebuild model" lives on this tab (Task 6 changes what it does).
- Tests:
  1. tabs and keyboard;
  2. editing a name, role, fact field, plan and forecast, then Save writes the expected doc with `editedAt`;
  3. unchecking a class hides it on the canvas after Save;
  4. Cancel writes nothing;
  5. a missing field is flagged and kept;
  6. a reload at `/settings/ontology` opens the tab.

### Task 6: Rebuild as a before / after proposal

**Files:** new `src/model/diff.ts`, `src/ui/OntologyTab.tsx`, new `src/ui/RebuildProposal.tsx`, `src/App.tsx`, tests.

**Produces:**
```ts
export type Change =
  | { kind: 'class_added' | 'class_removed'; classId: string; title: string }
  | { kind: 'metric_added' | 'metric_removed'; classId: string; metricId: string; alias: string }
  | { kind: 'metric_changed'; classId: string; metricId: string; field: 'alias' | 'role' | 'measure' | 'dateField' | 'plan' | 'kind'; before: string; after: string };
export function diffModels(current: Model, candidate: Model): Change[];
export function applyChanges(current: Model, candidate: Model, picked: Change[]): Model; // never touches shown flags or forecast; added classes/metrics come in shown: true; keeps editedAt unless something applied, then sets it (caller passes now)
```

- Rebuild runs `buildModel` with BuildProgress (Task 2) and saves nothing. With no changes it says "The model already matches the descriptions." Otherwise RebuildProposal lists one row per change. Each row has a checkbox (all on by default), the class, and before → after. Edges and the goal follow the candidate when a picked change adds or removes a class.
- **Apply selected** merges the picked changes, then saves and refreshes. **Discard** leaves the stored doc untouched.
- A blocked candidate shows the blocked screen's text inside the tab, and the current model is kept.
- The canvas "out of date" notice reads "The descriptions changed. Rebuild to see proposed changes" and opens the tab.
- Tests:
  1. `diffModels` covers each change kind;
  2. `applyChanges` with a subset, where unpicked changes stay as they were and shown and forecast are preserved;
  3. Discard leaves the doc deep-equal;
  4. an App flow from Rebuild to proposal to Apply.
