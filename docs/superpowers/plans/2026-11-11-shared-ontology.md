# Shared ontology and the ontology view: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One ontology model per project, an ontology view (no numbers) as the default with no date range, a flow view once a range is chosen, admin-only model changes, and Checkup as the setup page with sections, tooltips and one-click suggestions.

**Architecture:** The model moves from the member-scoped `ontology` collection to a new project-scoped `ontology_project` collection (v0.4.0). Core classes live in project settings and come from the business model in the project description on the first build. The canvas gets a second mode, `ontology`, used whenever the date range is null. Checkup is rebuilt around six sections; each check carries a purpose and an optional suggestion that an admin applies in one click.

**Tech Stack:** React 19, TypeScript, Vite, Vitest (happy-dom, Testing Library), `@owox/plugin-sdk` 0.42, `ai` 7 with zod 4.

**Spec:** `docs/superpowers/specs/2026-11-11-shared-ontology-design.md`. Read it before any task. Older specs it supersedes in part: `2026-10-24-gyroscope-design.md`, `2026-11-04-ontology-model-design.md`, `2026-11-04-checkup-design.md`.

## Global Constraints

1. Tests run with `npm test` (it already passes `--maxWorkers=4`). Never run Vitest without the worker cap. Typecheck with `npm run typecheck`.
2. Version 0.4.0: `package.json` `version` is `0.4.0`, `plugin.json` `delivery.url` is `https://owox.github.io/gyroscope/v4/`. `src/manifest.test.ts` enforces the pair.
3. Collections in `plugin.json`: keep `model` (project), `ontology` (member), `cache` (member), `settings` (project), `preferences` (member); add `ontology_project` (project). The plugin never writes `model` or `ontology` again.
4. A project admin is a member whose `GET /api/auth/context` `member.roles` includes `'admin'`. Any failure to read it means "not admin".
5. The AI runs only in two places: a build or Rebuild started by an admin, and a Checkup suggestion an admin opens. Opening the plugin, both canvas views, Refresh and the 0.4 migration never call `generate`.
6. Core classes: 3 to 7. A core class needs a single-column primary key; a date field is not required. Builds add core classes and never remove them.
7. Copy rules: sentence case, straight quotes, no em dashes in new UI text or comments. Match the existing comment density (one short `/** */` line on exported functions, a `//` line where the why isn't obvious).
8. UI strings from the spec are exact: "Select date range", "Clear", "None (ontology view)", "Only a project admin can change the model", "Ask a project admin", "An admin hasn't set up Gyroscope yet", "No access to this Data Mart", "<name> changed the model at <time>. Reload to see their changes."
9. Commit after each task with a `feat:`/`fix:`/`docs:` message ending in `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Do not push; the controller pushes.

## Review Focus

1. A member whose access differs from the admin's opens the plugin: they must see the same classes and connections, lock cards in the flow view, and never trigger a write or an AI call. Test owned by Task 6.
2. Two admins save the shared model one after the other from stale copies: the second save must stop with the "changed the model" message, not overwrite. Test owned by Task 2.
3. A Rebuild by an admin who can't access some Data Marts: classes, edges and metrics of those Data Marts must not appear as removals and must survive Apply. Test owned by Task 5.
4. The date range is null and the member clicks Refresh, changes context chips, or opens Settings and returns: no metric query runs and nothing crashes on `range === null`. Test owned by Task 8.
5. A project description that stops naming a core class: the next build keeps it in `coreClasses` and in the model's `core` flags. Test owned by Task 4.

---

## File map

| File | Change |
|---|---|
| `package.json`, `plugin.json`, `src/manifest.test.ts` | 0.4.0, `/v4/`, `ontology_project` collection |
| `src/types.ts` | `Model.version: 3`, `ClassNode.core/inbound`, `Model.editedBy`, `Settings` split into `ProjectSettings` and `ViewSettings`, `Industry`, `CoreClass`, `defaultPreset: Preset \| null` |
| `src/model/upgrade.ts` | v1 and v2 docs become v3 |
| `src/store/collections.ts` | `loadShared`, `saveShared` with conflict check, settings split, preferences |
| `src/owox/role.ts` (new) | `fetchIsAdmin(owox)` |
| `src/model/core.ts` (new) | `INDUSTRIES`, `inboundCounts`, `rankCore`, `mergeCore`, `applyCore` |
| `src/model/graph.ts` | `canBeClass` needs only a primary key |
| `src/model/interpret.ts` | AI output gains `coreClasses` |
| `src/model/build.ts` | core classes, no main-class fallback, `version: 3` |
| `src/model/diff.ts` | removals limited to Data Marts the builder can see |
| `src/model/seed.ts` | deleted |
| `src/App.tsx` | shared model, roles, nullable range, migration, not-set-up screen |
| `src/ui/layout.ts`, `src/ui/Canvas.tsx`, `src/ui/OntologyCard.tsx` (new) | ontology view and flow view rows |
| `src/ui/Header.tsx`, `src/ui/DateRangePicker.tsx`, `src/lib/dates.ts` | null range, "Select date range", Clear |
| `src/ui/SettingsPage.tsx` | tabs General and Checkup; General split into "Your view" and "Project" |
| `src/checkup/types.ts`, `src/checkup/run.ts` | six sections, `recommend` status, `purpose`, `suggestion` |
| `src/checkup/suggest.ts`, `src/checkup/suggestAi.ts`, `src/checkup/apply.ts` (new) | suggestions and Apply |
| `src/ui/CheckupTab.tsx` | sections, (i) tooltips, questions, Apply, Metrics section |
| `README.md` | release notes line |

---

### Task 1: Version 0.4, types and the v3 model

**Files:**
- Modify: `package.json`, `plugin.json`, `src/types.ts`, `src/model/upgrade.ts`
- Test: `src/manifest.test.ts`, `src/model/upgrade.test.ts`

**Interfaces:**
- Produces (in `src/types.ts`):
  ```ts
  export type Industry = 'ecommerce' | 'saas' | 'marketplace' | 'media' | 'b2b' | 'apps' | 'finance' | 'other';
  export interface CoreClass { martId: string; why: string }
  export interface ClassNode { /* existing */ core: boolean; inbound: number }
  export interface Model { version: 3; /* existing */ editedBy: string | null }
  /** Project-wide, admin only: settings collection, doc `project`. */
  export interface ProjectSettings { thresholdPct: number; industry: Industry | null; coreClasses: CoreClass[] | null }
  /** The member's own: preferences collection, doc `defaults`. null preset: no range, the ontology view. */
  export interface ViewSettings { defaultPreset: Preset | null; comparisonDefault: boolean; weekStart: WeekStart }
  export type Settings = ProjectSettings & ViewSettings;
  export const DEFAULT_SETTINGS: Settings = { thresholdPct: 20, industry: null, coreClasses: null, defaultPreset: null, comparisonDefault: true, weekStart: 'monday' };
  ```
- Produces: `upgradeModel(raw: unknown): Model | null` returns `version: 3` for v1, v2 and v3 input. Upgraded classes get `core: false`, `inbound: 0`; the model gets `editedBy: null`.

- [ ] **Step 1: Write the failing tests**

In `src/manifest.test.ts` add:

```ts
test('0.4 declares the shared ontology collection, project scope', () => {
  const cols = read('plugin.json').collections as { name: string; scope: string }[];
  expect(cols).toContainEqual({ name: 'ontology_project', scope: 'project' });
  expect(read('package.json').version).toBe('0.4.0');
});
```

In `src/model/upgrade.test.ts` add (reuse the file's existing v2 fixture builder; if none, build a minimal v2 doc inline the way the existing tests do):

```ts
test('a v2 doc becomes v3 with no core classes and no editor', () => {
  const m = upgradeModel(v2Doc())!;
  expect(m.version).toBe(3);
  expect(m.editedBy).toBeNull();
  expect(m.classes.every((c) => c.core === false && c.inbound === 0)).toBe(true);
});
test('a v3 doc keeps its core flags', () => {
  const v3 = { ...v2Doc(), version: 3, editedBy: 'u1', classes: v2Doc().classes.map((c, i) => ({ ...c, core: i === 1, inbound: 4 })) };
  const m = upgradeModel(v3)!;
  expect(m.classes.map((c) => c.core)).toEqual(v3.classes.map((c) => c.core));
  expect(m.editedBy).toBe('u1');
});
test('a v3 doc with a non-boolean core is rejected', () => {
  const bad = { ...v2Doc(), version: 3, editedBy: null, classes: v2Doc().classes.map((c) => ({ ...c, core: 'yes', inbound: 0 })) };
  expect(upgradeModel(bad)).toBeNull();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --maxWorkers=4 src/manifest.test.ts src/model/upgrade.test.ts`
Expected: FAIL (version 0.3.19, no collection, version stays 2).

- [ ] **Step 3: Implement**

1. `package.json` version `0.4.0`; `plugin.json` url `https://owox.github.io/gyroscope/v4/`, add `{ "name": "ontology_project", "scope": "project" }` after `ontology`.
2. `src/types.ts`: the types above. `Model.version` becomes `3`. Keep the old `Settings` field names so existing readers compile.
3. `src/model/upgrade.ts`: the v2 branch upgrades to v3 instead of returning; add a v3 branch that checks `editedBy === null || isStr(editedBy)`, `typeof c.core === 'boolean'`, `typeof c.inbound === 'number'`, then applies the same `keyFirst`/`fixFormat`/`fixKind` passes as v2. The v1 path chains into v2 then v3.
4. Fix every compile error from `version: 2` literals (`src/model/build.ts` returns `version: 3`, `core: false`, `inbound: 0`, `editedBy: null` for now; tests' fixtures in `src/test/fixtures.ts` get the same fields).

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: 0.4.0 with a project-scoped ontology collection and a v3 model with core classes"
```

---

### Task 2: Shared model storage and the settings split

**Files:**
- Modify: `src/store/collections.ts`
- Test: `src/store/collections.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  ```ts
  export async function loadShared(ctx: CollectionsLike): Promise<Model | null>;            // ontology_project/current
  export class ModelConflict extends Error { constructor(public by: string | null, public at: string) }
  /** Writes `next` only when the stored doc still has `base`'s builtAt and editedAt; else throws ModelConflict. base null: only when nothing is stored. */
  export async function saveShared(ctx: CollectionsLike, base: Model | null, next: Model): Promise<void>;
  export async function loadProjectSettings(ctx: CollectionsLike): Promise<ProjectSettings>;
  export async function saveProjectSettings(ctx: CollectionsLike, s: ProjectSettings): Promise<void>;
  export async function loadViewSettings(ctx: CollectionsLike): Promise<ViewSettings>;   // preferences/defaults, falling back to the project doc's old fields, then defaults
  export async function saveViewSettings(ctx: CollectionsLike, s: ViewSettings): Promise<void>;
  export async function loadSettings(ctx: CollectionsLike): Promise<Settings>;          // both, merged
  ```
  `loadOntology`, `saveOntology` and `saveSettings` are removed. `loadProjectModel` stays (migration source).
  `ViewSettings.defaultPreset` reads `null` when the member's doc lacks a `v4` marker: `saveViewSettings` writes `{ ...s, v: 4 }`, and `loadViewSettings` ignores a stored `defaultPreset` from a doc without `v: 4` (spec 5.4: a 0.3 preference is ignored once). `loadPreferences` likewise returns `null` for a `preferences/current` doc without `v: 4`; `savePreferences` writes `v: 4` and accepts `range: RangeChoice | null`.

- [ ] **Step 1: Write the failing tests**

```ts
test('saveShared refuses to overwrite a newer doc', async () => {
  const store = memoryCollections();
  const a = model({ builtAt: 't1', editedAt: null });
  await saveShared(store, null, a);
  const b = { ...a, editedAt: 't2', editedBy: 'u2' };
  await saveShared(store, a, b);
  const stale = { ...a, editedAt: 't3', editedBy: 'u1' };
  await expect(saveShared(store, a, stale)).rejects.toMatchObject({ name: 'ModelConflict', by: 'u2', at: 't2' });
  expect((await loadShared(store))!.editedAt).toBe('t2');
});
test('saveShared with no base refuses when a doc exists', async () => {
  const store = memoryCollections();
  await saveShared(store, null, model({ builtAt: 't1' }));
  await expect(saveShared(store, null, model({ builtAt: 't9' }))).rejects.toBeInstanceOf(ModelConflict);
});
test('a 0.3 default preset is ignored once; a 0.4 one is kept', async () => {
  const store = memoryCollections();
  await store.collections('preferences').put('defaults', { defaultPreset: 'qtd' });
  expect((await loadViewSettings(store)).defaultPreset).toBeNull();
  await saveViewSettings(store, { defaultPreset: 'mtd', comparisonDefault: false, weekStart: 'sunday' });
  expect(await loadViewSettings(store)).toEqual({ defaultPreset: 'mtd', comparisonDefault: false, weekStart: 'sunday' });
});
test('view settings fall back to the old project fields for comparison and week start', async () => {
  const store = memoryCollections();
  await store.collections('settings').put('project', { thresholdPct: 30, comparisonDefault: false, weekStart: 'sunday' });
  expect(await loadViewSettings(store)).toEqual({ defaultPreset: null, comparisonDefault: false, weekStart: 'sunday' });
  expect((await loadProjectSettings(store)).thresholdPct).toBe(30);
});
test('project settings keep only valid core classes', async () => {
  const store = memoryCollections();
  await store.collections('settings').put('project', { industry: 'saas', coreClasses: [{ martId: 'a', why: 'x' }, { martId: 5 }, null] });
  expect(await loadProjectSettings(store)).toEqual({ thresholdPct: 20, industry: 'saas', coreClasses: [{ martId: 'a', why: 'x' }] });
});
test('preferences from 0.3 are ignored once', async () => {
  const store = memoryCollections();
  await store.collections('preferences').put('current', { range: { kind: 'preset', preset: 'qtd' }, compare: { kind: 'off' } });
  expect(await loadPreferences(store)).toBeNull();
});
```

(`model(over)` is a local helper building a valid v3 `Model` from `src/test/fixtures.ts`.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=4 src/store/collections.test.ts`
Expected: FAIL (functions missing).

- [ ] **Step 3: Implement**

`saveShared` reads `ontology_project/current`, compares `builtAt` and `editedAt ?? null` with `base` (or requires no doc when `base` is null), throws `new ModelConflict(stored.editedBy ?? stored.builtBy, stored.editedAt ?? stored.builtAt)` on mismatch, else puts. Set `this.name = 'ModelConflict'` in the constructor. Industry validation: one of the `Industry` values or null. `coreClasses`: an array of `{ martId: string, why: string }`, invalid entries dropped, capped at 7, `null` when absent. Keep `isStale` unchanged. Update every caller in `src/App.tsx` to compile (behaviour changes come in Task 6); delete `loadOntology`/`saveOntology` imports there and temporarily call `loadShared`/`saveShared(store, model, next)`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS (fix fixtures in App tests that seeded `ontology` to seed `ontology_project` instead).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: one shared model doc with a conflict check; view settings belong to the member"
```

---

### Task 3: Roles and core class ranking

**Files:**
- Create: `src/owox/role.ts`, `src/owox/role.test.ts`, `src/model/core.ts`, `src/model/core.test.ts`
- Modify: `src/model/graph.ts` (`canBeClass`), `src/model/graph.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/owox/role.ts
  /** True when the member's roles include admin; any failure reads as not admin. */
  export async function fetchIsAdmin(owox: OwoxLike): Promise<boolean>; // getJson<{ member?: { roles?: unknown } }>('/api/auth/context')
  // src/model/core.ts
  export const INDUSTRIES: { id: Industry; label: string; count: number; typical: string[] }[];
  /** Distinct Data Marts whose calculated fields reference each target. */
  export function inboundCounts(edges: Edge[]): Map<string, number>;
  /** Candidates ranked for core: single-column primary key, not the goal, directly connected to the goal, inbound > 0. */
  export function rankCore(args: { goalId: string; nodes: { id: string; title: string; singleKey: boolean }[]; edges: Edge[] }): string[];
  /** Existing core classes stay; new picks are added in order until 7. null existing: the picks, or the ranked top `count`. */
  export function mergeCore(existing: CoreClass[] | null, picks: CoreClass[], ranked: string[], count: number): CoreClass[];
  /** Sets core and inbound on the model's classes from the list; classes not in the model are ignored. */
  export function applyCore(model: Model, core: CoreClass[], inbound: ReadonlyMap<string, number>): Model;
  export const singleKey: (detail: MartDetail) => boolean; // exactly one primary key path
  ```
  `INDUSTRIES` holds exactly the spec 8.2 table: ecommerce 5, saas 5, marketplace 6, media 4, b2b 4, apps 4, finance 5, other 3, with the typical names listed there.
- `canBeClass(detail)` becomes `hasPrimaryKey(detail)`.

- [ ] **Step 1: Write the failing tests**

```ts
// role.test.ts
test.each([
  [{ member: { roles: ['admin'] } }, true],
  [{ member: { roles: ['editor', 'viewer'] } }, false],
  [{ member: {} }, false],
])('roles %j: admin %s', async (body, want) => {
  const owox = { getJson: vi.fn().mockResolvedValue(body) } as unknown as OwoxLike;
  expect(await fetchIsAdmin(owox)).toBe(want);
});
test('a failed auth call is not admin', async () => {
  const owox = { getJson: vi.fn().mockRejectedValue(new Error('403')) } as unknown as OwoxLike;
  expect(await fetchIsAdmin(owox)).toBe(false);
});

// core.test.ts
const e = (from: string, to: string): Edge => ({ from, to });
test('ranks by inbound references, then links to other candidates, then title', () => {
  const nodes = [
    { id: 'rev', title: 'Revenue', singleKey: true }, { id: 'cus', title: 'Customers', singleKey: true },
    { id: 'pro', title: 'Products', singleKey: true }, { id: 'vis', title: 'Visitors', singleKey: true },
    { id: 'cmp', title: 'Composite', singleKey: false }, { id: 'far', title: 'Far', singleKey: true },
  ];
  const edges = [e('rev', 'cus'), e('rev', 'pro'), e('x', 'cus'), e('y', 'cus'), e('x', 'pro'), e('rev', 'vis'), e('rev', 'cmp'), e('x', 'far'), e('cus', 'pro')];
  expect(rankCore({ goalId: 'rev', nodes, edges })).toEqual(['cus', 'pro', 'vis']);
});
test('a candidate that only references the goal counts as connected but needs inbound references', () => {
  const nodes = [{ id: 'rev', title: 'Revenue', singleKey: true }, { id: 'ses', title: 'Sessions', singleKey: true }];
  expect(rankCore({ goalId: 'rev', nodes, edges: [e('ses', 'rev')] })).toEqual([]);
  expect(rankCore({ goalId: 'rev', nodes, edges: [e('ses', 'rev'), e('z', 'ses')] })).toEqual(['ses']);
});
test('mergeCore keeps existing, adds picks, caps at 7', () => {
  const c = (id: string) => ({ martId: id, why: id });
  expect(mergeCore(null, [c('a'), c('b')], ['x'], 3)).toEqual([c('a'), c('b')]);
  expect(mergeCore(null, [], ['x', 'y', 'z', 'w'], 3)).toEqual([{ martId: 'x', why: '' }, { martId: 'y', why: '' }, { martId: 'z', why: '' }]);
  expect(mergeCore([c('a'), c('b')], [c('b'), c('c')], [], 5)).toEqual([c('a'), c('b'), c('c')]);
  expect(mergeCore([c('a')], [], ['x'], 5)).toEqual([c('a')]); // a set list is never refilled from the ranking
  expect(mergeCore([1, 2, 3, 4, 5, 6, 7].map((i) => c(`k${i}`)), [c('new')], [], 5)).toHaveLength(7);
});
test('applyCore flags classes and records inbound counts', () => {
  const m = applyCore(fixtureModel(), [{ martId: fixtureModel().classes[1]!.martId, why: '' }], new Map([[fixtureModel().classes[1]!.id, 3]]));
  expect(m.classes[1]).toMatchObject({ core: true, inbound: 3 });
  expect(m.classes.filter((c) => c.core)).toHaveLength(1);
});
```

In `graph.test.ts`, change the date-field expectation: a Data Mart with a primary key and no date field can be a class.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=4 src/owox/role.test.ts src/model/core.test.ts src/model/graph.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the functions as specified. Connection to the goal in `rankCore`: an edge `goal -> id` or `id -> goal`. Ties: inbound desc, then the number of edges to or from other candidates desc, then `title.localeCompare`. `inboundCounts` counts distinct `from` per `to`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS. Checkup tests that expected "No date field, so not on the canvas" may now fail; update them to the new rule (an undated Data Mart with a primary key is a class).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: admin role check and core class ranking; a class no longer needs a date field"
```

---

### Task 4: Build picks core classes from the description

**Files:**
- Modify: `src/model/interpret.ts`, `src/model/build.ts`
- Test: `src/model/interpret.test.ts`, `src/model/build.test.ts`

**Interfaces:**
- Consumes: `rankCore`, `mergeCore`, `applyCore`, `inboundCounts`, `singleKey`, `INDUSTRIES` (Task 3).
- Produces:
  - `AiOutputSchema` gains `coreClasses: z.array(z.object({ martId: z.string(), why: z.string() })).catch([])`.
  - `InterpretInput` gains `marts: { id: string; title: string; description: string | null }[]`; the prompt adds a `DATA MARTS:` block (`<id>: <title> - <first line of description>`) and rule 10: "coreClasses lists the Data Marts, by id from DATA MARTS, for the business entities the PROJECT DESCRIPTION describes as its business model: who buys, what is sold, where visitors come from. At most 7. Empty when the description doesn't describe the business model."
  - `buildModel(args)` gains `existingCore: CoreClass[] | null` and `industry: Industry | null`; its ok result gains `core: { classes: CoreClass[]; fromDescription: boolean }`.
  - Without a visible goal Data Mart, the build blocks with the new `BlockCode` `'GOAL_NO_ACCESS'`, detail "You can't access the Data Mart that owns the critical number. Ask a project admin with access to build the model." The `viaFallback` path is removed from `buildModel` (keep `chooseMain` exported for Checkup until Task 9).

- [ ] **Step 1: Write the failing tests** (in `build.test.ts`, using the file's existing fake-owox and stub-generate helpers)

```ts
test('the first build takes core classes from the description', async () => {
  // fake project: goal Orders; Customers and Products have one primary key and are referenced by Orders; Sessions references Orders
  const gen = stubGenerate({ ...goalOutput, coreClasses: [{ martId: 'customers', why: 'Who buys' }, { martId: 'nokey', why: 'x' }] });
  const r = await buildModel({ owox, generate: gen, userId: 'u', now, existingCore: null, industry: null });
  expect(r.ok && r.core).toEqual({ classes: [{ martId: 'customers', why: 'Who buys' }], fromDescription: true });
  expect(r.ok && r.model.classes.find((c) => c.id === 'customers')!.core).toBe(true);
});
test('without picks the ranking fills the industry count', async () => {
  const r = await buildModel({ owox, generate: stubGenerate({ ...goalOutput, coreClasses: [] }), userId: 'u', now, existingCore: null, industry: 'other' });
  expect(r.ok && r.core.fromDescription).toBe(false);
  expect(r.ok && r.core.classes.length).toBeGreaterThan(0);
});
test('a core class the description no longer names stays', async () => {
  const r = await buildModel({ owox, generate: stubGenerate({ ...goalOutput, coreClasses: [{ martId: 'products', why: 'What is sold' }] }), userId: 'u', now,
    existingCore: [{ martId: 'customers', why: 'Who buys' }], industry: null });
  expect(r.ok && r.core.classes.map((c) => c.martId)).toEqual(['customers', 'products']);
  expect(r.ok && r.model.classes.filter((c) => c.core).map((c) => c.id).sort()).toEqual(['customers', 'products']);
});
test('a core class without a date field is in the model', async () => { /* customers has no date field */ });
test('no access to the goal Data Mart blocks with GOAL_NO_ACCESS', async () => {
  const r = await buildModel({ owox: withoutMart(owox, 'orders'), generate: stubGenerate(goalOutput), userId: 'u', now, existingCore: null, industry: null });
  expect(!r.ok && r.blocked.code).toBe('GOAL_NO_ACCESS');
});
```

In `interpret.test.ts`: the prompt contains `DATA MARTS:` and each mart id; an output without `coreClasses` parses to `[]`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=4 src/model/interpret.test.ts src/model/build.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `buildModel`: pass `inputs.marts` to `interpret`. After nodes load: `const inbound = inboundCounts(edges)`, `ranked = rankCore({ goalId: main.id, nodes: nodes.map((n) => ({ id: n.id, title: n.title, singleKey: singleKey(n.detail) })), edges })`, picks = `ai.coreClasses` filtered to nodes with `singleKey` and not the goal, de-duplicated; `count = INDUSTRIES.find((i) => i.id === (args.industry ?? 'other'))!.count`; `core = mergeCore(args.existingCore, picks, ranked, count)`. Core classes must be in `depths`: add each core id with depth 1 when the walk didn't reach it but it is connected to the goal. `model = applyCore(model, core, inbound)`. Return `core: { classes: core, fromDescription: picks.length > 0 }`. Add `'GOAL_NO_ACCESS'` to `BlockCode` and to `Blocked.tsx`'s titles/steps (one line: "Ask a project admin with access to the goal Data Mart").

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: the build takes core classes from the business model in the description and never drops one"
```

---

### Task 5: Rebuild never removes what the builder can't see

**Files:**
- Modify: `src/model/diff.ts`, `src/ui/RebuildProposal.tsx`
- Test: `src/model/diff.test.ts`, `src/ui/RebuildProposal.test.tsx`

**Interfaces:**
- Produces: `diffModels(current, candidate, visible?: ReadonlySet<string>): Change[]`. A `class_removed` or `metric_removed` whose Data Mart is not in `visible` is not emitted; instead a `{ kind: 'kept'; classId; title }` change is emitted once per such class. `applyChanges` ignores `kept` rows and keeps those classes, their metrics and every edge that touches them, even when `relink` would drop them. `core` flags of the current model are always kept (a rebuild never unflags).
- `RebuildProposal` renders `kept` rows without a checkbox: "Kept: you can't access <title>".

- [ ] **Step 1: Write the failing tests**

```ts
test('classes the builder can't see are kept, not removed', () => {
  const current = fixtureModel(); // classes a (goal), b, c; edges a->b, a->c
  const candidate = { ...current, classes: current.classes.filter((x) => x.id !== 'c'), edges: current.edges.filter((x) => x.to !== 'c'), metrics: current.metrics.filter((m) => m.martId !== 'c') };
  const changes = diffModels(current, candidate, new Set(['a', 'b']));
  expect(changes).toContainEqual({ kind: 'kept', classId: 'c', title: current.classes.find((x) => x.id === 'c')!.title });
  expect(changes.some((x) => x.kind === 'class_removed')).toBe(false);
  const applied = applyChanges(current, candidate, changes, 'now');
  expect(applied.classes.map((x) => x.id)).toContain('c');
  expect(applied.edges).toContainEqual(expect.objectContaining({ from: 'a', to: 'c' }));
  expect(applied.metrics.some((m) => m.martId === 'c')).toBe(true);
});
test('a class the builder can see and the candidate drops is still proposed for removal', () => {
  const current = fixtureModel();
  const candidate = { ...current, classes: current.classes.filter((x) => x.id !== 'c') };
  expect(diffModels(current, candidate, new Set(['a', 'b', 'c']))).toContainEqual(expect.objectContaining({ kind: 'class_removed', classId: 'c' }));
});
test('core flags survive apply', () => { /* current c.core true, candidate c.core false: applied c.core true */ });
```

RebuildProposal: a `kept` row shows its text and no checkbox.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=4 src/model/diff.test.ts src/ui/RebuildProposal.test.tsx`

- [ ] **Step 3: Implement** as specified. In `OntologyTab`, pass the access set (`marts` ids) to `diffModels`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run typecheck && npm test`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: a rebuild keeps classes the builder can't access and never unflags a core class"
```

---

### Task 6: App runs on the shared model, with roles and migration

**Files:**
- Modify: `src/App.tsx`, `src/ui/SettingsPage.tsx` (props only), `src/ui/OntologyTab.tsx` (read-only mode)
- Delete: `src/model/seed.ts`, `src/model/seed.test.ts`
- Test: `src/App.load.test.tsx`, `src/App.ontology.test.tsx`, `src/App.ready.test.tsx`, `src/ui/OntologyTab.test.tsx`

**Interfaces:**
- Consumes: `loadShared`, `saveShared`, `ModelConflict`, `loadSettings`, `saveProjectSettings`, `saveViewSettings` (Task 2), `fetchIsAdmin` (Task 3), `applyCore`, `inboundCounts`, `rankCore` (Task 3), build `core` result (Task 4).
- Produces: `AppDeps` gains nothing; App state gains `isAdmin: boolean`. `View` gains `{ name: 'not_set_up' }`. `OntologyTab` gains `readOnly?: boolean`; when true every input is disabled, Save and Rebuild are hidden, and a note reads "Only a project admin can change the model".

Load sequence (replaces the seed block):
1. In parallel: `loadSettings`, `loadShared`, `loadPreferences`, `fetchIsAdmin`.
2. No shared doc: read `loadProjectModel`. If found and the member is an admin, migrate: core = `settings.coreClasses` if set, else `rankCore` over the model's classes (every class has a primary key by construction; `singleKey: true`) using `model.edges`, top `INDUSTRIES` count for `settings.industry ?? 'other'`; `applyCore`; `saveShared(store, null, migrated)`; on `ModelConflict`, reload. A non-admin uses the migrated model in memory without saving.
3. No shared doc and no project model: an admin starts the build; a member gets `not_set_up`, which shows "An admin hasn't set up Gyroscope yet" and a "Run checkup" button to `/settings/checkup`.
4. After a successful build or Apply (admin only): `saveShared(store, modelNow, next)` with `editedBy: userId`; then, if `result.core` changed `settings.coreClasses`, `saveProjectSettings`. A `ModelConflict` shows the spec message `"<name> changed the model at <HH:MM>. Reload to see their changes."` with a Reload button that calls `load()`.
5. `visible` no longer removes classes: pass the access set to Canvas as `visibleIds` (Task 9 renders lock cards; until then the existing no-access card renders for every inaccessible class instead of dropping it).
6. A member never calls `build` or `generate`. `canRebuild` is `isAdmin && !!generate`.

- [ ] **Step 1: Write the failing tests** (App tests use the existing `test-host.tsx` helpers and `memoryCollections`)

```ts
test('two members with different access see the same classes', async () => {
  const store = memoryCollections();
  await store.collections('ontology_project').put('current', sharedModel); // classes goal, cus, pro
  const admin = renderApp({ store, owox: fakeOwox({ marts: ['goal', 'cus', 'pro'], roles: ['admin'] }) });
  const titlesA = await cardTitles(admin);
  admin.unmount();
  const member = renderApp({ store, owox: fakeOwox({ marts: ['goal'], roles: ['viewer'] }) });
  expect(await cardTitles(member)).toEqual(titlesA);
});
test('a member with no shared and no project model sees the not-set-up screen and no AI runs', async () => {
  const generate = vi.fn();
  renderApp({ store: memoryCollections(), generate, owox: fakeOwox({ roles: ['viewer'] }) });
  expect(await screen.findByText("An admin hasn't set up Gyroscope yet")).toBeInTheDocument();
  expect(generate).not.toHaveBeenCalled();
});
test('an admin migrates the 0.3 project model without an AI call', async () => {
  const store = memoryCollections();
  await store.collections('model').put('current', v2ProjectModel);
  const generate = vi.fn();
  renderApp({ store, generate, owox: fakeOwox({ roles: ['admin'] }) });
  await waitFor(async () => expect((await store.collections<Model>('ontology_project').get('current'))?.document.version).toBe(3));
  expect(generate).not.toHaveBeenCalled();
});
test('a member opening the 0.3 project model does not write it', async () => { /* ontology_project stays empty */ });
test('a save over a newer shared doc shows the conflict message', async () => {
  /* admin opens Metrics; another write bumps editedAt in the store; Save -> text matches /changed the model at \d\d:\d\d\. Reload to see their changes\./ */
});
```

OntologyTab: with `readOnly`, inputs are disabled and Save is absent.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=4 src/App.load.test.tsx src/App.ontology.test.tsx src/ui/OntologyTab.test.tsx`

- [ ] **Step 3: Implement** the load sequence and the save paths above. Remove `seedFrom`, `withoutUndated`, `SEED_NOTE` and `seedNote`. Extend `fakeOwox` in `src/owox/fake.ts` with `roles` (served at `/api/auth/context`).

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run typecheck && npm test`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix: every member of a project reads one shared model; only admins build, migrate or save it"
```

---

### Task 7: The ontology view

**Files:**
- Create: `src/ui/OntologyCard.tsx`, `src/ui/OntologyCard.test.tsx`
- Modify: `src/ui/layout.ts`, `src/ui/layout.test.ts`, `src/ui/Canvas.tsx`, `src/ui/Canvas.test.tsx`, `src/styles.css`

**Interfaces:**
- Produces:
  ```ts
  // layout.ts
  /** The goal and its core classes, in rank order; connectors only between those classes. */
  export interface OntologyLayout { goal: ClassNode | null; core: ClassNode[]; connectors: Connector[] }
  export function ontologyLayout(model: Model, selected: ReadonlySet<string>): OntologyLayout;
  // OntologyCard.tsx
  export function OntologyCard(props: { cls: ClassNode; mart?: MartInfo; goal: boolean }): JSX.Element; // icon + large centered title, data-class-id
  // Canvas.tsx
  interface Props { mode: 'ontology' | 'flow'; /* existing */ }
  ```
  Rank order of core: by `inbound` desc, then title. Context chips filter core classes as they filter drivers; the goal always shows.
- Layout: a CSS grid `.gy-orbit` with the goal in the center cell and core cards placed clockwise from the top. Use positions from a fixed table for 3 to 7 cards (top, right, bottom, left, then the corners), with the goal card larger (`.gy-ocard[data-goal="true"]`, blue border `#459ce9`). Lines use the existing `curve` and arrow markers with tone `'none'`.
- In `mode === 'ontology'` the Canvas renders no `LoadingBar`, no Goal/Drivers bands, and no number cards.

- [ ] **Step 1: Write the failing tests**

```ts
// layout.test.ts
test('ontology layout has the goal, the core classes by inbound, and lines among them only', () => {
  const m = modelWith({ classes: [goal('g'), cls('a', { core: true, inbound: 1 }), cls('b', { core: true, inbound: 5 }), cls('x', { core: false })],
    edges: [{ from: 'g', to: 'a' }, { from: 'g', to: 'b' }, { from: 'a', to: 'b' }, { from: 'g', to: 'x' }] });
  const l = ontologyLayout(m, new Set());
  expect(l.goal?.id).toBe('g');
  expect(l.core.map((c) => c.id)).toEqual(['b', 'a']);
  expect(l.connectors.map((c) => `${c.from}>${c.to}`).sort()).toEqual(['a>b', 'g>a', 'g>b']);
});
// Canvas.test.tsx
test('the ontology mode shows names only', () => {
  render(<Canvas mode="ontology" model={m} cache={cacheWithNumbers} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('Customers')).toBeInTheDocument();
  expect(screen.queryByText('$1.24M')).toBeNull();
  expect(document.querySelector('.gy-spark')).toBeNull();
});
```

OntologyCard: renders the title in an element with class `gy-ocard-title`, and `data-goal="true"` for the goal.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=4 src/ui/layout.test.ts src/ui/Canvas.test.tsx src/ui/OntologyCard.test.tsx`

- [ ] **Step 3: Implement**, then add CSS: `.gy-orbit` grid 3x3 at desktop width with `gap: 48px`; under 640px it stacks the goal first, then core cards in one column (no horizontal scroll). `.gy-ocard-title` 22px, weight 600, centered. Respect the existing theme tokens in `styles.css`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run typecheck && npm test`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: the ontology view, with the goal class in the center and its core classes around it"
```

---

### Task 8: Empty date range by default

**Files:**
- Modify: `src/lib/dates.ts` (`controlLabel`), `src/ui/DateRangePicker.tsx`, `src/ui/Header.tsx`, `src/App.tsx`, `src/metrics/refresh.ts` (types only), `src/ui/SettingsPage.tsx`
- Test: `src/ui/DateRangePicker.test.tsx`, `src/ui/Header.test.tsx`, `src/App.ready.test.tsx`, `src/ui/SettingsPage.test.tsx`

**Interfaces:**
- Produces: `controlLabel(range: RangeChoice | null, compare)` returns `'Select date range'` for null. `DateRangePicker` and `RangeControls` accept `range: RangeChoice | null` and `onChange(range: RangeChoice | null, compare)`. The panel shows a **Clear** button when a range is set; Clear calls `onChange(null, compare)` and closes. With a null range, the panel opens with no preset highlighted and the comparison section disabled. `RangeControls` hides Refresh when `range` is null.
- App: `range` state is `RangeChoice | null`, initialised from `prefs?.range ?? (settings.defaultPreset ? preset : null)`. With `range === null`: Canvas `mode="ontology"`, no `refresh` call, no cache read, no loading line, Header shows no period and no "Updated" text. `remember` saves `range: null` too.
- Settings General: "Default date range" gets a first option `None (ontology view)` with value `''`, mapped to `null`.

- [ ] **Step 1: Write the failing tests**

```ts
test('no range: the picker reads Select date range and Refresh is hidden', () => {
  render(<RangeControls range={null} compare={{ kind: 'off' }} now={now} onChange={vi.fn()} onRefresh={vi.fn()} onSettings={vi.fn()} />);
  expect(screen.getByText('Select date range')).toBeInTheDocument();
  expect(screen.queryByLabelText('Refresh')).toBeNull();
});
test('Clear empties the range', async () => {
  const onChange = vi.fn();
  render(<DateRangePicker range={{ kind: 'preset', preset: 'mtd' }} compare={{ kind: 'off' }} now={now} onChange={onChange} />);
  await user.click(screen.getByLabelText('Date range'));
  await user.click(screen.getByRole('button', { name: 'Clear' }));
  expect(onChange).toHaveBeenCalledWith(null, { kind: 'off' });
});
test('the first open shows the ontology view and queries nothing', async () => {
  const owox = fakeOwox({ roles: ['viewer'] });
  renderApp({ store: storeWithShared(), owox });
  await screen.findByText('Select date range');
  expect(owox.dataMarts.traverseData).not.toHaveBeenCalled();
});
test('choosing a range runs the queries; Clear stops showing numbers', async () => { /* pick 'This month', wait for traverseData; Clear; numbers gone */ });
test('Settings offers None (ontology view) and it is the default', () => { /* select value '' selected for defaultPreset null */ });
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=4 src/ui/DateRangePicker.test.tsx src/ui/Header.test.tsx src/App.ready.test.tsx src/ui/SettingsPage.test.tsx`

- [ ] **Step 3: Implement** as specified. Guard every `resolveRange`, `cacheKey`, `persistable` and `compareLabel` call in `App.tsx` behind `range !== null`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run typecheck && npm test`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: the date range starts empty and shows the ontology view; Clear goes back to it"
```

---

### Task 9: The flow view rows and lock cards

**Files:**
- Modify: `src/ui/layout.ts`, `src/ui/Canvas.tsx`, `src/ui/Card.tsx`, `src/metrics/refresh.ts`, `src/checkup/run.ts` (drop `chooseMain` use), `src/model/graph.ts` (remove `chooseMain` and `viaFallback`)
- Test: `src/ui/layout.test.ts`, `src/ui/Canvas.test.tsx`, `src/ui/Card.test.tsx`, `src/metrics/refresh.test.ts`

**Interfaces:**
- Produces: `layoutFor(model, selected)` returns `{ main, core: ClassNode[], drivers: ClassNode[], connectors }`. `core` are the core classes in rank order; `drivers` are the rest, by depth then title. Canvas `mode="flow"` renders three bands: Goal, Core (icon `Boxes`), Drivers.
- A class whose Data Mart is not in `visibleIds` renders the existing no-access card body with a `Lock` icon and the text "No access to this Data Mart", in the flow view only. `refreshCanvas` already skips classes outside `visibleIds`; keep that.
- A metric with `dateField === null` on a core class shows its value with no % diff, no sparkline and no forecast. Unique Count label stays "<count> <Class>".

- [ ] **Step 1: Write the failing tests**

```ts
test('flow layout: goal, then core by inbound, then the rest by depth', () => {
  const l = layoutFor(m, new Set());
  expect([l.main?.id, l.core.map((c) => c.id), l.drivers.map((c) => c.id)]).toEqual(['g', ['b', 'a'], ['x']]);
});
test('a class the member cannot access shows a lock card and is not queried', async () => {
  render(<Canvas mode="flow" model={m} cache={null} visibleIds={new Set(['g', 'a'])} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(within(card('b')).getByText('No access to this Data Mart')).toBeInTheDocument();
});
test('an undated core metric shows no diff and no sparkline', () => { /* Card with metric dateField null and result note no_date_field */ });
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=4 src/ui/layout.test.ts src/ui/Canvas.test.tsx src/ui/Card.test.tsx src/metrics/refresh.test.ts`

- [ ] **Step 3: Implement.** Remove the filter in Canvas that dropped non-visible classes; pass `noAccess` for every such class. Remove `chooseMain`; Checkup's `connections.reachable` now passes when the goal Data Mart is visible, else fails with "You can't access the goal Data Mart".

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run typecheck && npm test`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: the flow view puts core classes between the goal and the rest, and locks classes a member can't access"
```

---

### Task 10: Checkup sections, statuses and purposes

**Files:**
- Modify: `src/checkup/types.ts`, `src/checkup/run.ts`
- Test: `src/checkup/run.test.ts`

**Interfaces:**
- Produces (`src/checkup/types.ts`):
  ```ts
  export type CheckStatus = 'running' | 'ok' | 'recommend' | 'warn' | 'fail' | 'skip';
  export type GroupId = 'critical' | 'core' | 'contexts' | 'connections' | 'metrics' | 'housekeeping';
  export interface Option { label: string; value: unknown; recommended: boolean }
  export type ApplyTarget =
    | { kind: 'settings'; patch: Partial<ProjectSettings> }
    | { kind: 'description'; mode: 'append' | 'metrics_table'; text: string }
    | { kind: 'context_create'; name: string; description: string }
    | { kind: 'context_update'; id: string; name: string; description: string }
    | { kind: 'mart_contexts'; martId: string; contextIds: string[] }
    | { kind: 'model'; action: 'build' | 'rebuild' };
  export interface Suggestion { question: string; options: Option[]; ai: boolean; target: (o: Option) => ApplyTarget }
  export interface Check { /* existing */ purpose: string; suggestion?: Suggestion }
  export const GROUPS: { id: GroupId; label: string; purpose: string }[];
  ```
  Labels and purposes: `GROUPS` holds the six sections with the purpose sentence from spec 8.2 (bold lead lines). `PURPOSES: Record<string, string>` in `run.ts` holds one or two sentences per check id; every id in `LABELS` has one (a test enforces it).
- Check ids and sections:
  - critical: `project.description`, `project.table`, `project.critical`, `project.fact`, `project.links`, `goal.access`, `goal.field`, `goal.pk`, `goal.date`, `project.plan` (warn), `project.shape` (new, recommend).
  - core: `core.business` (new, warn), `core.industry` (new, warn), `core.set` (new, warn), `core.keys` (new, warn), `core.toGoal` (new, warn), `core.linked` (new, recommend), `core.count` (new, recommend), `core.missing` (new, recommend).
  - contexts: `contexts.exist` (warn), `context:<id>.description` (now recommend), `.marts` (warn), `.fact` (warn, label "It has a critical number row with a fact"), `.plan` (now recommend), `.links` (warn).
  - connections: `connections.reachable` (fail), `connections.any`, `connections.facts`, `connections.pk` (warn), `connections.date` (now recommend, detail "No date field: shows in the ontology view, with no numbers: …").
  - metrics: `model.built` (new, fail), `model.health` (warn), `model.fresh` (warn), `model.keys` (new, recommend), `model.plans` (new, recommend).
  - housekeeping: `plugin.ai` (fail), `model.history` (new, recommend; detail "Last edited by <name>, <date>").
- `runCheckup` gains `settings: ProjectSettings` and returns checks without suggestions; Task 11 attaches them.
- `core.business`: passes when the build would find picks, judged without the AI as "the project description names at least one core class's Data Mart title or links it". `core.set`: `settings.coreClasses` has 3 to 7 entries. `core.keys`, `core.toGoal`, `core.linked` judge `settings.coreClasses` (or, when null, `rankCore`'s top picks) against the loaded schemas and edges. `core.missing`: a Data Mart with `singleKey`, inbound >= 3, not core.

- [ ] **Step 1: Write the failing tests** (extend `run.test.ts` fixtures)

```ts
test('every check has a purpose and a known section', async () => {
  const checks = await runCheckup(args());
  for (const c of checks) { expect(c.purpose.length).toBeGreaterThan(10); expect(GROUPS.map((g) => g.id)).toContain(c.group); }
});
test('the core section warns when no core classes are set', async () => {
  const checks = await runCheckup(args({ settings: { thresholdPct: 20, industry: null, coreClasses: null } }));
  expect(byId(checks, 'core.set').status).toBe('warn');
  expect(byId(checks, 'core.industry').status).toBe('warn');
});
test('a core class without a single primary key is a warning naming it', async () => { /* coreClasses [{martId:'composite'}] -> core.keys warn, detail contains its title */ });
test('a context with no description is a recommendation', async () => { /* status 'recommend' */ });
test('no model is a blocker in the metrics section', async () => { /* model null -> model.built fail */ });
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=4 src/checkup/run.test.ts`

- [ ] **Step 3: Implement.** Keep the existing logic and ids; move them to the new groups; add the new checks. Keep one schema fetch per Data Mart per run (the existing cache).

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run typecheck && npm test`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Checkup sections for the critical number, core classes, contexts, connections, metrics and housekeeping"
```

---

### Task 11: Suggestions and one-click Apply

**Files:**
- Create: `src/checkup/suggest.ts`, `src/checkup/suggest.test.ts`, `src/checkup/suggestAi.ts`, `src/checkup/suggestAi.test.ts`, `src/checkup/apply.ts`, `src/checkup/apply.test.ts`
- Modify: `src/checkup/tables.ts` (`upsertMetricsTable`), `src/checkup/tables.test.ts`, `src/owox/sources.ts` (`OwoxLike` gains optional `putJson`, `postJson` already optional, `project.updateDescription?`)

**Interfaces:**
- Produces:
  ```ts
  // suggest.ts: code-only suggestions, from what the run loaded
  export interface SuggestContext { inputs: Inputs; nodes: MartNode[]; edges: Edge[]; goalId: string | null; settings: ProjectSettings; projectId: string }
  export function codeSuggestion(checkId: string, ctx: SuggestContext): Suggestion | null;
  // suggestAi.ts: AI suggestions, called only when an admin opens the question
  export async function aiSuggestion(checkId: string, ctx: SuggestContext, generate: Generate): Promise<Suggestion | null>;
  // apply.ts
  export type ApplyResult = { ok: true } | { ok: false; refused: true; snippet: string } | { ok: false; refused: false; error: string };
  export async function applyTarget(t: ApplyTarget, deps: { owox: OwoxLike; store: CollectionsLike; settings: ProjectSettings; onModel: (action: 'build' | 'rebuild') => void }): Promise<ApplyResult>;
  // tables.ts
  /** Replaces the first Metrics table in the description, or appends one; the rest of the text stays byte for byte. */
  export function upsertMetricsTable(markdown: string | null, table: string): string;
  ```
- Code suggestions (no AI):
  - `project.fact`/`project.critical`/`project.table`: options are up to 4 additive money fields (`SUM` over a NUMERIC/FLOAT/INTEGER field whose name or alias matches `/revenue|sales|profit|gmv|amount|income/i`) in Data Marts with a primary key and a date field, ranked by the mart's inbound count; target `{ kind: 'description', mode: 'metrics_table', text }` with the Metrics table snippet from `Blocked.metricsSnippet` filled with the chosen link.
  - `project.plan`: fields matching `/plan|target|budget|goal/i` in Data Marts sharing the fact's date field type, plus "No plan yet" (target `settings` with an empty patch, which marks nothing and just closes).
  - `core.set`/`core.count`/`core.missing`: options from `rankCore`, sized by `INDUSTRIES` for `settings.industry ?? 'other'`; target `{ kind: 'settings', patch: { coreClasses } }`.
  - `contexts.exist`: names by industry (ecommerce: Marketing, Sales, Product; saas: Marketing, Sales, Customer success; other: Marketing, Sales); target `context_create`.
  - `context:<id>.marts`: Data Marts whose title shares a word with the context name; target `mart_contexts` with the mart's existing context ids plus this one.
- AI suggestions (`suggestAi.ts`, one `generate` call each, zod-validated, `temperature: 0` comes from `aiGenerate`): `project.description` and `core.business` (a paragraph naming core Data Marts by title; target `description` append), `core.industry` (options from `INDUSTRIES`, the AI preselects; target `settings` `{ industry }`), `context:<id>.description` (target `context_update`), `context:<id>.fact` (target `description` for that context via `context_update` with the upserted table).
  `aiGenerate` takes a schema today; add `aiGenerateWith(model, schema, signal)` in `interpret.ts` and keep `aiGenerate` as `aiGenerateWith(model, AiOutputSchema, signal)`.
- Apply writes: `settings` merges into `loadProjectSettings` and saves; `description` reads `owox.project.getSettings()`, then `PUT /api/projects/settings/description` with `{ description }` through `owox.project.updateDescription` (fall back to `putJson`); `context_create` `POST /api/contexts`; `context_update` `PUT /api/contexts/{id}`; `mart_contexts` `PUT /api/data-marts/{id}/contexts` with `{ contextIds }`; `model` calls `onModel`. An error whose status is 401 or 403 (use `describeError` and the same status walk as `isNotFound` in `build.ts`) returns `refused: true` with a snippet of the text that would have been written.

- [ ] **Step 1: Write the failing tests**

```ts
// tables.test.ts
test('upsertMetricsTable replaces only the Metrics table', () => {
  const md = 'Intro.\n\n| Role | Metric | Plan | Fact |\n|---|---|---|---|\n| Critical number | Old | | |\n\nOutro.';
  const out = upsertMetricsTable(md, '| Role | Metric | Plan | Fact |\n|---|---|---|---|\n| Critical number | Revenue | | [Revenue](/ui/p/data-marts/o/data-setup?field=revenue) |');
  expect(out.startsWith('Intro.\n\n')).toBe(true);
  expect(out.endsWith('\n\nOutro.')).toBe(true);
  expect(out).toContain('| Critical number | Revenue |');
  expect(out).not.toContain('| Old |');
});
test('upsertMetricsTable appends when there is none', () => {
  expect(upsertMetricsTable('Just text.', 'T')).toBe('Just text.\n\nT');
  expect(upsertMetricsTable(null, 'T')).toBe('T');
});
// suggest.test.ts
test('core suggestion is sized by industry and recommends the top-ranked', () => {
  const s = codeSuggestion('core.set', ctxWith({ industry: 'media' }))!;
  expect(s.options.filter((o) => o.recommended)).toHaveLength(1);
  expect((s.target(s.options[0]!) as { patch: ProjectSettings }).patch.coreClasses).toHaveLength(4);
});
test('the critical number suggestion prefers a revenue field in a dated Data Mart with a key', () => { /* option[0].label 'Revenue (Orders)' */ });
// apply.test.ts
test('a refused description write returns the snippet', async () => {
  const owox = { ...fake, project: { getSettings: async () => ({ description: 'x' }), updateDescription: vi.fn().mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 })) } };
  const r = await applyTarget({ kind: 'description', mode: 'append', text: 'P' }, deps(owox));
  expect(r).toEqual({ ok: false, refused: true, snippet: 'P' });
});
test('settings apply merges into the project settings', async () => { /* coreClasses saved, threshold kept */ });
// suggestAi.test.ts
test('an industry suggestion preselects the AI answer and offers every industry', async () => {
  const s = (await aiSuggestion('core.industry', ctx, async () => ({ industry: 'saas' })))!;
  expect(s.options).toHaveLength(8);
  expect(s.options.find((o) => o.recommended)!.value).toBe('saas');
});
test('an unreadable AI answer gives no suggestion', async () => {
  expect(await aiSuggestion('core.industry', ctx, async () => ({ nope: 1 }))).toBeNull();
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=4 src/checkup`

- [ ] **Step 3: Implement** as specified. `runCheckup` attaches `codeSuggestion` to every check that isn't `ok`/`skip`, and marks `ai: true` on checks that `aiSuggestion` covers (the UI fetches those lazily).

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run typecheck && npm test`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Checkup suggests a value for each unfilled setting and applies it in one click"
```

---

### Task 12: Checkup UI with the Metrics section; Settings tabs

**Files:**
- Modify: `src/ui/CheckupTab.tsx`, `src/ui/SettingsPage.tsx`, `src/App.tsx`, `src/styles.css`
- Test: `src/ui/CheckupTab.test.tsx`, `src/ui/SettingsPage.test.tsx`, `src/App.ontology.test.tsx`

**Interfaces:**
- Consumes: Tasks 10 and 11.
- Produces: `CheckupProps` gains `isAdmin: boolean`, `apply: (t: ApplyTarget) => Promise<ApplyResult>`, `suggestAi?: (checkId: string) => Promise<Suggestion | null>`, `ontology?: OntologyProps | null` (rendered inside the Metrics section), `rerun` per section is a full rerun (keep it simple).
- Settings tabs: `general` and `checkup` only. `/settings/ontology` opens Checkup with the Metrics section expanded and scrolled into view. General has two fieldsets: "Your view" (default date range, week start, comparison; saved with `saveViewSettings`) and "Project" (threshold; admins only, otherwise read-only with "Only a project admin can change this").
- Each section: `CollapsibleCard` heading with the worst status mark (✗, !, 💡, ✓) and a count ("1 warning, 1 recommendation"). Expanded on first render when the section has a blocker or warning, or when the project has no model.
- Each check: the existing row plus an (i) button (reuse `InfoTip` from `OntologyTab.tsx`; export it from there or move it to `src/ui/InfoTip.tsx`) whose text is `check.purpose`. Under a check that isn't passing and has a suggestion: the question, radio options (recommended preselected and labelled "Recommended"), and for an admin an **Apply** button. For `ai` suggestions, an admin sees "Suggest an answer" which calls `suggestAi` once and caches it per check id for the session. A member sees the question and the recommended option read-only with "Ask a project admin", and never sees "Suggest an answer".
- Apply: shows a spinner on the button, then reruns the checkup. A `refused` result shows the snippet in a `<pre class="gy-snippet">` with Copy, plus the check's existing Fix link. An `error` shows the message under the button.

- [ ] **Step 1: Write the failing tests**

```ts
test('sections show the worst status and every check has an (i) tooltip', async () => {
  render(<CheckupTab {...props({ checks: [warnCheck('core.set'), okCheck('project.fact'), recommendCheck('core.linked')] })} />);
  expect(await screen.findByRole('heading', { name: /Core classes.*warning/ })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /^About / })).toHaveLength(3);
});
test('an admin applies the recommended answer in one click', async () => {
  const apply = vi.fn().mockResolvedValue({ ok: true });
  render(<CheckupTab {...props({ isAdmin: true, apply, checks: [warnCheck('core.set', { suggestion: coreSuggestion })] })} />);
  await user.click(await screen.findByRole('button', { name: 'Apply' }));
  expect(apply).toHaveBeenCalledWith({ kind: 'settings', patch: { coreClasses: expect.any(Array) } });
});
test('a member sees the question read-only', async () => {
  render(<CheckupTab {...props({ isAdmin: false, checks: [warnCheck('core.set', { suggestion: coreSuggestion })] })} />);
  expect(await screen.findByText('Ask a project admin')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
});
test('a refused write shows the snippet', async () => { /* apply resolves { ok:false, refused:true, snippet:'S' } -> <pre> contains S */ });
test('the AI suggestion is fetched once, only when asked', async () => { /* suggestAi called 0 times on render, 1 after clicking "Suggest an answer" twice */ });
test('Settings has General and Checkup tabs, and /settings/ontology opens the Metrics section', async () => { /* */ });
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=4 src/ui/CheckupTab.test.tsx src/ui/SettingsPage.test.tsx src/App.ontology.test.tsx`

- [ ] **Step 3: Implement.** In `App.tsx`, bind `apply` with `applyTarget` (its `onModel` starts a build for `build`, or opens the Metrics section's Rebuild for `rebuild`), and `suggestAi` with `aiSuggestion` and the generate handle, passed only when `isAdmin && generate`. After an Apply of `settings` with `coreClasses`, update the shared model's `core` flags with `applyCore` and `saveShared`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run typecheck && npm test`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Checkup is the setup page, with sections, tooltips, one-click answers and the Metrics section"
```

---

### Task 13: Docs and release notes

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-11-11-shared-ontology-design.md` (status line)

- [ ] **Step 1:** README: under "Requirements in OWOX", add a line that a project admin opens Gyroscope first to build the shared model, and that the project description should describe the business model. Under "Release", replace `v3/` with `v4/` for 0.4.x.
- [ ] **Step 2:** Spec status: "Status: implemented in 0.4.0 (2026-11-11)."
- [ ] **Step 3:** Run `npm run typecheck && npm test && npm run build`. Expected: all pass, `dist/` builds.
- [ ] **Step 4:** Commit: `git add -A && git commit -m "docs: 0.4.0 shared ontology notes"`.
