# Data Mart Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an OWOX v2 plugin that auto-generates an interactive, editable dashboard from any Data Mart, with all aggregation performed server-side.

**Architecture:** Three repos. (A) `owox-data-marts` gains one REST endpoint exposing the existing `QueryDataMartService`. (B) `owox-data-marts-experimental` stamps the author onto collection docs server-side. (C) This repo is the plugin: a `plugin.json` + React `ui/` that stores one JSON doc per dashboard in `collections('dashboards')` and renders it by compiling each component into one server-side aggregated query.

**Tech Stack:** NestJS + TypeORM + Zod (backend), React 19 + TypeScript + Vite + Tailwind + shadcn/ui + recharts (plugin), vitest.

**Spec:** `docs/superpowers/specs/2026-07-11-data-mart-dashboards-design.md`

## Global Constraints

- **No client-side calculations.** Every aggregate, group-by, date bucket, filter and total is computed by the server. The only client-side math permitted is presentation formatting (number/date display).
- **All plugin data access goes through `owox.request(method, path, body?)`.** The plugin holds no token, no API key.
- **Charts:** recharts wrapped in the shadcn `chart.tsx` component; colors `var(--chart-1)`…`var(--chart-5)`.
- **CSS is precompiled and committed** (`ui/styles.src.css` → `ui/styles.css`). The host compiles plugin CSS with the **default** Tailwind theme and ignores `tailwind.config`, so shadcn tokens (`--background`, `--chart-N`, `.dark`) must be baked in.
- **Page chrome is mandatory and verbatim:** `dm-page > dm-page-header(+dm-page-header-title) > dm-page-content > dm-card`. Never rebuild the card from Tailwind utilities.
- **Keep host-provided deps external:** `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`, `react-router-dom`, `@owox/plugin-sdk`. Never add `@owox/plugin-sdk` to `package.json`. Every other runtime dep (e.g. `recharts`, `lucide-react`) goes in `dependencies`, not `devDependencies`.
- **No `backend.ts`** in v1 (production backend execution is pending the host WASM sandbox).
- **Query API limits (v1 scopes to these):** finest date grain is `DAY` (no `HOUR`); operators `in`, `not_in`, `this_week`, `in_next_n_days` are rejected by the service; `limit` is 1..1000; there is **no pagination/offset**.
- **Run vitest with `--maxWorkers=4`.** Never run test suites at full parallelism.
- Reference implementation to copy conventions from: `/Users/flakss/Projects/report-builder`.

---

## File Structure

**Repo A — `/Users/flakss/Projects/owox-data-marts`**
- Create: `apps/backend/src/data-marts/dto/presentation/query-data-mart-request-api.dto.ts` — request DTO.
- Create: `apps/backend/src/data-marts/dto/presentation/query-data-mart-response-api.dto.ts` — response DTO.
- Create: `apps/backend/src/data-marts/controllers/spec/query-data-mart.spec.ts` — Swagger decorator.
- Modify: `apps/backend/src/data-marts/controllers/data-mart.controller.ts` — add `POST :id/query`.
- Test: `apps/backend/src/data-marts/controllers/data-mart-query.controller.spec.ts`

**Repo B — `/Users/flakss/Projects/owox-data-marts-experimental`**
- Modify: `packages/host-backend/src/broker/capabilities/collections.ts` — stamp `$createdBy`/`$createdAt`.
- Test: `packages/host-backend/src/broker/capabilities/collections.spec.ts`

**Repo C — this repo (the plugin)**
- `plugin.json` — manifest.
- `ui/lib/types.ts` — Dashboard doc, Component, FilterRule, QueryRequest/QueryResult.
- `ui/lib/api.ts` — brokered OWOX calls incl. `queryDataMart`.
- `ui/lib/compile.ts` — **the core**: `(component, filters, slices) → QueryRequest`.
- `ui/lib/dashboards.ts` — `collections('dashboards')` CRUD with `$entity`.
- `ui/lib/generate.ts` — schema + cardinality probes → Dashboard doc.
- `ui/lib/freshness.ts` — `useLayerData` loading/stale/refresh.
- `ui/lib/filterOps.ts`, `ui/lib/format.ts`.
- `ui/components/*` — list, view, grid, filter bar, 5 component renderers, editors.

---

## Task 1: `POST /api/data-marts/:id/query` (repo A)

**Repo:** `/Users/flakss/Projects/owox-data-marts`

> **Prerequisite:** the working tree is 53 commits behind `origin/main` and does **not** contain `QueryDataMartService`. Pull first.

**Files:**
- Create: `apps/backend/src/data-marts/dto/presentation/query-data-mart-request-api.dto.ts`
- Create: `apps/backend/src/data-marts/dto/presentation/query-data-mart-response-api.dto.ts`
- Modify: `apps/backend/src/data-marts/controllers/data-mart.controller.ts`
- Test: `apps/backend/src/data-marts/controllers/data-mart-query.controller.spec.ts`

**Interfaces:**
- Consumes (already exists, do NOT rewrite): `QueryDataMartService.run(command: QueryDataMartCommand, signal?: AbortSignal): Promise<McpQueryDataMartResponse>` from `../use-cases/query-data-mart.service`; `QueryDataMartCommand` wraps `McpQueryDataMartRequest`:
  ```ts
  interface McpQueryDataMartRequest {
    projectId: string; userId: string; roles: string[];
    dataMartId: string; fields: string[];
    filterConfig?: FilterConfig;         // FilterRule[] | null — { column, operator, value?, placement?: 'pre-join'|'post-join' }
    aggregationConfig?: AggregationConfig; // AggregationRule[] | null — { column, function }
    dateTruncConfig?: DateTruncConfig;   // DateTruncRule[] | null — { column, unit, timeZone? }
    limit: number;                        // 1..1000
  }
  interface McpQueryDataMartResponse {
    columns: string[]; rows: unknown[][]; truncated: boolean;
    totals: Record<string, number | string | boolean | null> | null;
  }
  ```
  `QueryDataMartService` is already registered in `data-marts.module.ts` — no module change needed.
- Produces: `POST /api/data-marts/:id/query` returning `McpQueryDataMartResponse` verbatim.

- [ ] **Step 1: Pull the branch that contains QueryDataMartService**

```bash
cd /Users/flakss/Projects/owox-data-marts
git status --short          # must be clean; stash if not
git pull --ff-only origin main
test -f apps/backend/src/data-marts/use-cases/query-data-mart.service.ts && echo OK
```
Expected: `OK`

- [ ] **Step 2: Write the failing controller test**

Create `apps/backend/src/data-marts/controllers/data-mart-query.controller.spec.ts`:

```ts
import { DataMartController } from './data-mart.controller';
import { QueryDataMartCommand } from '../use-cases/query-data-mart.service';
import type { AuthorizationContext } from '../../idp';

describe('DataMartController.query', () => {
  const context = { projectId: 'p1', userId: 'u1', roles: ['editor'] } as AuthorizationContext;
  const response = { columns: ['c'], rows: [[1]], truncated: false, totals: null };

  function build(run = jest.fn().mockResolvedValue(response)) {
    const svc = { run } as never;
    // Only the query dependency is exercised; the rest are unused by this route.
    const controller = Object.create(DataMartController.prototype) as DataMartController;
    (controller as unknown as { queryDataMartService: unknown }).queryDataMartService = svc;
    return { controller, run };
  }

  it('passes auth context, id, and body through to QueryDataMartService', async () => {
    const { controller, run } = build();
    const body = {
      fields: ['date', 'revenue'],
      aggregationConfig: [{ column: 'revenue', function: 'SUM' as const }],
      dateTruncConfig: [{ column: 'date', unit: 'MONTH' as const }],
      filterConfig: [{ column: 'country', operator: 'eq', value: 'US' }],
      limit: 100,
    };

    const result = await controller.query(context, 'dm1', body as never);

    expect(result).toEqual(response);
    const command: QueryDataMartCommand = run.mock.calls[0][0];
    expect(command.request).toEqual({
      projectId: 'p1', userId: 'u1', roles: ['editor'],
      dataMartId: 'dm1',
      fields: ['date', 'revenue'],
      filterConfig: body.filterConfig,
      aggregationConfig: body.aggregationConfig,
      dateTruncConfig: body.dateTruncConfig,
      limit: 100,
    });
  });

  it('defaults limit to 20 and configs to null when omitted', async () => {
    const { controller, run } = build();
    await controller.query(context, 'dm1', { fields: ['a'] } as never);
    const command: QueryDataMartCommand = run.mock.calls[0][0];
    expect(command.request.limit).toBe(20);
    expect(command.request.filterConfig).toBeNull();
    expect(command.request.aggregationConfig).toBeNull();
    expect(command.request.dateTruncConfig).toBeNull();
  });

  it('defaults roles to [] when the context carries none', async () => {
    const { controller, run } = build();
    await controller.query({ projectId: 'p1', userId: 'u1' } as AuthorizationContext, 'dm1', { fields: ['a'] } as never);
    expect((run.mock.calls[0][0] as QueryDataMartCommand).request.roles).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd /Users/flakss/Projects/owox-data-marts
npx jest --maxWorkers=4 apps/backend/src/data-marts/controllers/data-mart-query.controller.spec.ts
```
Expected: FAIL — `controller.query is not a function`.

- [ ] **Step 4: Create the request DTO**

Create `apps/backend/src/data-marts/dto/presentation/query-data-mart-request-api.dto.ts`:

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { FilterConfigSchema } from '../schemas/filter-config.schema';
import { AggregationConfigSchema } from '../schemas/aggregation-config.schema';
import { DateTruncConfigSchema } from '../schemas/date-trunc-config.schema';

/**
 * Body of `POST /api/data-marts/:id/query`. Group-by is implied: a projected field WITH an
 * aggregation rule is a metric; a projected field WITHOUT one is a grouping key. Sending no
 * `aggregationConfig` therefore returns raw, ungrouped rows.
 */
export const QueryDataMartRequestSchema = z.object({
  fields: z.array(z.string().min(1)).min(1),
  filterConfig: FilterConfigSchema.optional(),
  aggregationConfig: AggregationConfigSchema.optional(),
  dateTruncConfig: DateTruncConfigSchema.optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

export class QueryDataMartRequestApiDto extends createZodDto(QueryDataMartRequestSchema) {}
```

> If `nestjs-zod` / `createZodDto` is not the established pattern in this repo, mirror whatever
> `UpdateBlendedFieldsConfigApiDto` (`apps/backend/src/data-marts/dto/presentation/update-blended-fields-config-api.dto.ts`)
> does — follow the existing convention rather than introducing a new one.

- [ ] **Step 5: Create the response DTO**

Create `apps/backend/src/data-marts/dto/presentation/query-data-mart-response-api.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

export class QueryDataMartResponseApiDto {
  @ApiProperty({ type: [String], description: 'Output column names. Aggregated columns are labelled "<field> | <FN>"; an aggregated plan also appends "Row Count".' })
  columns: string[];

  @ApiProperty({ type: 'array', items: { type: 'array', items: {} }, description: 'Result rows, positionally aligned to `columns`.' })
  rows: unknown[][];

  @ApiProperty({ description: 'True when the row limit (or the internal byte cap) truncated the result.' })
  truncated: boolean;

  @ApiProperty({ nullable: true, description: 'Ungrouped totals over ALL matching rows, ignoring `limit`. Null when unavailable.' })
  totals: Record<string, number | string | boolean | null> | null;
}
```

- [ ] **Step 6: Add the route to the controller**

Modify `apps/backend/src/data-marts/controllers/data-mart.controller.ts`.

Add imports:
```ts
import { QueryDataMartRequestApiDto } from '../dto/presentation/query-data-mart-request-api.dto';
import { QueryDataMartResponseApiDto } from '../dto/presentation/query-data-mart-response-api.dto';
import { QueryDataMartCommand, QueryDataMartService } from '../use-cases/query-data-mart.service';
```

Add to the constructor parameter list:
```ts
    private readonly queryDataMartService: QueryDataMartService,
```

Add the route (place it beside the other `:id` routes):
```ts
  /**
   * Read rows from a Data Mart with server-side aggregation. `POST` (not `GET`) because the
   * query is a structured body; it is read-only, and the plugin broker maps `POST .../query`
   * to a `view` grant.
   */
  @Auth(Role.viewer(Strategy.PARSE))
  @Post(':id/query')
  @HttpCode(200)
  @QueryDataMartSpec()
  async query(
    @AuthContext() context: AuthorizationContext,
    @Param('id') id: string,
    @Body() dto: QueryDataMartRequestApiDto
  ): Promise<QueryDataMartResponseApiDto> {
    return this.queryDataMartService.run(
      new QueryDataMartCommand({
        projectId: context.projectId,
        userId: context.userId,
        roles: context.roles ?? [],
        dataMartId: id,
        fields: dto.fields,
        filterConfig: dto.filterConfig ?? null,
        aggregationConfig: dto.aggregationConfig ?? null,
        dateTruncConfig: dto.dateTruncConfig ?? null,
        limit: dto.limit ?? 20,
      })
    );
  }
```

`@HttpCode(200)` is required: Nest defaults `@Post` to 201, and this is a read.

- [ ] **Step 7: Add the Swagger spec decorator**

Create `apps/backend/src/data-marts/controllers/spec/query-data-mart.spec.ts`, following the shape of the neighbouring files in that folder:

```ts
import { applyDecorators } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { QueryDataMartResponseApiDto } from '../../dto/presentation/query-data-mart-response-api.dto';

export function QueryDataMartSpec() {
  return applyDecorators(
    ApiOperation({
      summary: 'Query a Data Mart',
      description:
        'Reads rows with server-side aggregation. Group-by is implied: a projected field with an ' +
        'aggregation rule is a metric, one without is a grouping key. `totals` is computed over all ' +
        'matching rows, ignoring `limit`.',
    }),
    ApiOkResponse({ type: QueryDataMartResponseApiDto })
  );
}
```

Import it in the controller: `import { QueryDataMartSpec } from './spec/query-data-mart.spec';`

- [ ] **Step 8: Run the test to verify it passes**

```bash
cd /Users/flakss/Projects/owox-data-marts
npx jest --maxWorkers=4 apps/backend/src/data-marts/controllers/data-mart-query.controller.spec.ts
```
Expected: PASS (3 tests).

- [ ] **Step 9: Typecheck and lint**

```bash
cd /Users/flakss/Projects/owox-data-marts
npx tsc --noEmit -p apps/backend/tsconfig.json
npx eslint apps/backend/src/data-marts/controllers/data-mart.controller.ts apps/backend/src/data-marts/dto/presentation/query-data-mart-*.ts
```
Expected: no errors.

- [ ] **Step 10: Verify by hand against a real mart**

Start the backend, then (replace the id and auth header with real values):
```bash
curl -s -X POST "http://localhost:3000/api/data-marts/<ID>/query" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer <TOKEN>" \
  -d '{"fields":["Date","Cost"],"aggregationConfig":[{"column":"Cost","function":"SUM"}],"dateTruncConfig":[{"column":"Date","unit":"MONTH"}],"limit":12}' | head -20
```
Expected: JSON with `columns` including `Cost | SUM`, monthly `rows`, and a non-null `totals`.

- [ ] **Step 11: Commit**

```bash
git add apps/backend/src/data-marts/controllers/data-mart.controller.ts \
        apps/backend/src/data-marts/controllers/spec/query-data-mart.spec.ts \
        apps/backend/src/data-marts/controllers/data-mart-query.controller.spec.ts \
        apps/backend/src/data-marts/dto/presentation/query-data-mart-request-api.dto.ts \
        apps/backend/src/data-marts/dto/presentation/query-data-mart-response-api.dto.ts
git commit -m "feat(data-marts): expose POST /api/data-marts/:id/query over QueryDataMartService"
```

---

## Task 2: Stamp the author on collection docs (repo B)

**Repo:** `/Users/flakss/Projects/owox-data-marts-experimental`

`identity.whoami` was removed from the plugin surface, so a plugin cannot learn who the user is. The host stamps it instead, on write. The plugin reads `$createdBy` back but never learns the *viewer's* id — which preserves the privacy decision that motivated the removal.

**Files:**
- Modify: `packages/host-backend/src/broker/capabilities/collections.ts`
- Test: `packages/host-backend/src/broker/capabilities/collections.spec.ts`

**Interfaces:**
- Consumes: `CapabilityContext { pluginId, projectId, userId, requireGrant }`. It carries **only** `userId` — no name or email.
- Produces: on `put`, the stored doc gains reserved fields `$createdBy: string`, `$createdAt: string` (ISO), `$updatedAt: string` (ISO). `$createdBy`/`$createdAt` are preserved from the existing doc on update; they are never taken from plugin input.

- [ ] **Step 1: Write the failing tests**

Add to `packages/host-backend/src/broker/capabilities/collections.spec.ts` (match the existing describe/setup style in that file):

```ts
it('stamps $createdBy/$createdAt on first put', async () => {
  const cap = makeCap();                       // existing helper in this spec file
  const stored = (await cap.invoke('put', ['dashboards', 'd1', { name: 'A' }], ctx('u1'))) as Record<string, unknown>;
  expect(stored.$createdBy).toBe('u1');
  expect(typeof stored.$createdAt).toBe('string');
  expect(typeof stored.$updatedAt).toBe('string');
});

it('preserves the original author on update by another user', async () => {
  const cap = makeCap();
  await cap.invoke('put', ['dashboards', 'd1', { name: 'A' }], ctx('u1'));
  const updated = (await cap.invoke('put', ['dashboards', 'd1', { name: 'B' }], ctx('u2'))) as Record<string, unknown>;
  expect(updated.$createdBy).toBe('u1');       // NOT u2
  expect(updated.name).toBe('B');
});

it('ignores a $createdBy supplied by the plugin', async () => {
  const cap = makeCap();
  const stored = (await cap.invoke('put', ['dashboards', 'd1', { $createdBy: 'spoofed' }], ctx('u1'))) as Record<string, unknown>;
  expect(stored.$createdBy).toBe('u1');
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd /Users/flakss/Projects/owox-data-marts-experimental
npx vitest run packages/host-backend/src/broker/capabilities/collections.spec.ts --poolOptions.threads.maxThreads=4
```
Expected: FAIL — `$createdBy` is `undefined`.

- [ ] **Step 3: Implement the stamp**

In `packages/host-backend/src/broker/capabilities/collections.ts`, add the reserved-field constants next to `ENTITY_FIELD`:

```ts
/** Reserved authorship fields. Stamped by the host on write; plugin-supplied values are ignored. */
const CREATED_BY_FIELD = '$createdBy';
const CREATED_AT_FIELD = '$createdAt';
const UPDATED_AT_FIELD = '$updatedAt';
```

Replace the `case 'put'` block with:

```ts
      case 'put': {
        const id = a as string; requireId(id);
        const doc = (b ?? {}) as Record<string, unknown>;
        await this.assertWritable(ns, id, doc, ctx);

        const existing = (await this.deps.store.find(ns, { id }))[0];
        const now = new Date().toISOString();
        // Authorship is host-owned: strip whatever the plugin sent, then stamp. On update the
        // ORIGINAL author and creation time survive — an editor never becomes the author.
        const { [CREATED_BY_FIELD]: _by, [CREATED_AT_FIELD]: _at, [UPDATED_AT_FIELD]: _up, ...clean } = doc;
        return this.deps.store.insert(ns, {
          ...clean,
          id,
          [CREATED_BY_FIELD]: (existing?.[CREATED_BY_FIELD] as string | undefined) ?? ctx.userId,
          [CREATED_AT_FIELD]: (existing?.[CREATED_AT_FIELD] as string | undefined) ?? now,
          [UPDATED_AT_FIELD]: now,
        }); // upserts on explicit id
      }
```

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run packages/host-backend/src/broker/capabilities/collections.spec.ts --poolOptions.threads.maxThreads=4
```
Expected: PASS (all, including the pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add packages/host-backend/src/broker/capabilities/collections.ts \
        packages/host-backend/src/broker/capabilities/collections.spec.ts
git commit -m "feat(broker): stamp \$createdBy/\$createdAt/\$updatedAt on collection docs"
```

> **Tracked debt:** `$createdBy` is an opaque user id — the host has no display name in
> `CapabilityContext`. Rendering a human-readable author requires a user lookup upstream. Out of scope.

---

## Task 3: Scaffold the plugin (repo C)

**Repo:** this repo (`/Users/flakss/Projects/data-mart-dashboardization`)

**Files:**
- Create: `plugin.json`, `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `postcss.config.js`, `tailwind.config.ts`, `.gitignore`
- Create: `ui/index.html`, `ui/main.tsx`, `ui/App.tsx`, `ui/styles.src.css`, `ui/styles.css`, `ui/sdk-mock.ts`
- Create: `scripts/link-monorepo.sh`, `owox.dev.example.json`
- Create: `src/test-setup.ts`

**Interfaces:**
- Produces: a plugin that installs and renders an empty "Dashboards" page inside the OWOX chrome.

- [ ] **Step 1: Copy the starter and strip it**

```bash
cd /Users/flakss/Projects/data-mart-dashboardization
STARTER=/Users/flakss/Projects/owox-data-marts-experimental/packages/plugin-starter
REF=/Users/flakss/Projects/report-builder
cp -r "$STARTER"/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,postcss.config.js,tailwind.config.ts,owox.dev.example.json,.gitignore} .
cp -r "$STARTER"/ui ./ui
cp -r "$STARTER"/src ./src
rm -f ui/App.test.tsx backend.ts
cp "$REF/scripts/link-monorepo.sh" scripts/link-monorepo.sh 2>/dev/null || mkdir -p scripts
```
Verify `.gitignore` contains `owox.dev.json`, `node_modules`, `dist`. **Never commit `owox.dev.json`** — it holds a live API key.

- [ ] **Step 2: Write `plugin.json`**

```json
{
  "id": "data-mart-dashboards",
  "name": "Dashboards",
  "version": "0.1.0",
  "ui": { "entry": "ui/index.html" },
  "menu": [{ "title": "Dashboards", "path": "" }],
  "credentials": [{ "type": "data-mart", "scope": "all", "actions": ["view"] }],
  "collections": [{ "name": "dashboards", "scope": "project" }]
}
```

There is **no** `backend` key and no `tools` — v1 is frontend-only.

- [ ] **Step 3: Add runtime deps**

In `package.json`, ensure `dependencies` (NOT devDependencies) contains:
```json
  "dependencies": {
    "recharts": "^2.13.0",
    "lucide-react": "^0.400.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.5.0",
    "class-variance-authority": "^0.7.0"
  }
```
Do **not** add `@owox/plugin-sdk` — it is host-provided and aliased via `tsconfig` `paths` to `ui/sdk-mock.ts`.

```bash
npm install
```

- [ ] **Step 4: Copy the mandatory `.dm-*` chrome CSS**

Copy the `.dm-*` block **verbatim** from `/Users/flakss/Projects/owox-data-marts-experimental/packages/plugin-starter/ui/styles.css` into `ui/styles.src.css`, and add the shadcn token block (`:root` + `.dark` with `--background`, `--foreground`, `--card`, `--border`, `--muted`, `--primary`, `--radius`, and `--chart-1`…`--chart-5`) by copying from `/Users/flakss/Projects/report-builder/ui/styles.src.css`.

Add a `css` script to `package.json` that compiles `styles.src.css` → `styles.css`, mirroring report-builder:
```json
    "css": "tailwindcss -i ui/styles.src.css -o ui/styles.css --minify"
```
Then:
```bash
npm run css
```
`ui/styles.css` is a **committed build artifact** — `ui/main.tsx` imports `./styles.css`, never the source.

- [ ] **Step 5: Write `ui/App.tsx` with the mandatory chrome**

```tsx
export function App() {
  return (
    <div className="dm-page text-foreground">
      <header className="dm-page-header">
        <h1 className="dm-page-header-title">Dashboards</h1>
      </header>
      <div className="dm-page-content">
        <div className="dm-card">
          <p className="p-6 text-sm">No dashboards yet.</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify the host build will succeed**

```bash
npm install --ignore-scripts --omit=dev && npx esbuild ui/main.tsx --bundle --format=esm \
  --external:react --external:react-dom --external:react-dom/client \
  --external:react/jsx-runtime --external:react/jsx-dev-runtime \
  --external:react-router-dom --external:@owox/plugin-sdk --outfile=/tmp/probe.js
```
Expected: succeeds, no unresolved imports. **This probe must pass at the end of every subsequent task.**

- [ ] **Step 7: Run it**

```bash
npm run dev     # → http://localhost:5173, renders the Dashboards page in OWOX chrome
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: scaffold data-mart-dashboards plugin"
```

---

## Task 4: `ui/lib/types.ts` — the data model

**Files:**
- Create: `ui/lib/types.ts`

**Interfaces:**
- Produces: every type below. All later tasks import from here.

- [ ] **Step 1: Write the types**

```ts
// ---------- OWOX query API (POST /api/data-marts/:id/query) ----------

export type AggregateFunction =
  | 'SUM' | 'COUNT' | 'COUNT_DISTINCT' | 'AVG' | 'MIN' | 'MAX'
  | 'P25' | 'P50' | 'P75' | 'P95';

/** No HOUR: DAY is the finest grain the query service supports. */
export type DateTruncUnit = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

export type AggregationRule = { column: string; function: AggregateFunction };
export type DateTruncRule = { column: string; unit: DateTruncUnit; timeZone?: string };
export type SortRule = { column: string; direction: 'asc' | 'desc' };

/** `in`/`not_in`/`this_week` are REJECTED by the service — never emit them. */
export type FilterRule = {
  column: string;
  operator: string;
  value?: unknown;
  placement?: 'pre-join' | 'post-join';
};

export type QueryRequest = {
  fields: string[];
  filterConfig?: FilterRule[] | null;
  aggregationConfig?: AggregationRule[] | null;
  dateTruncConfig?: DateTruncRule[] | null;
  limit?: number;
};

export type QueryResult = {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  totals: Record<string, number | string | boolean | null> | null;
};

// ---------- Data mart schema ----------

export type FieldRole = 'dimension' | 'metric';

export type MartField = {
  name: string;
  type: string;
  role: FieldRole;
  allowedAggregations: AggregateFunction[];
};

export type MartRef = { id: string; title: string };

// ---------- The dashboard document ----------

export type ComponentType = 'scorecard' | 'timeseries' | 'bar' | 'pie' | 'donut' | 'table';

export type ScorecardConfig = { metric: string; aggregation: AggregateFunction };
export type TimeSeriesConfig = {
  dateField: string; metric: string; aggregation: AggregateFunction;
  unit: DateTruncUnit; breakdown?: string;
};
export type BarConfig = {
  dimension: string; metric: string; aggregation: AggregateFunction;
  orientation: 'vertical' | 'horizontal'; limit: number;
  sort?: 'asc' | 'desc';
};
export type PieConfig = {
  dimension: string; metric: string; aggregation: AggregateFunction; maxCategories: number;
};
export type TableConfig = { columns: string[]; sort?: SortRule[]; limit: number };

export type ComponentConfig =
  | ScorecardConfig | TimeSeriesConfig | BarConfig | PieConfig | TableConfig;

export type Component = {
  id: string;
  type: ComponentType;
  title: string;
  description?: string;
  /** Column span, 1..gridColumns. */
  width: number;
  /** Row span. Default 1. */
  height: number;
  config: ComponentConfig;
};

export type Dashboard = {
  id: string;
  /** Binds the doc's ACL to the ONE data mart it visualises. Host-enforced. */
  $entity: { type: 'data-mart'; id: string };
  name: string;
  gridColumns: number;
  /** GLOBAL — applied to every component. No per-component overrides by design. */
  filters: FilterRule[];
  slices: FilterRule[];
  components: Component[];
  /** Bumped on every edit; doubles as the refetch key. */
  configVersion: number;
  generatedAt?: string;
  // Stamped server-side by the host on put — read-only to the plugin.
  $createdBy?: string;
  $createdAt?: string;
  $updatedAt?: string;
};

export const emptyDashboard = (id: string, martId: string, name: string): Dashboard => ({
  id,
  $entity: { type: 'data-mart', id: martId },
  name,
  gridColumns: 5,
  filters: [],
  slices: [],
  components: [],
  configVersion: 0,
});
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add ui/lib/types.ts && git commit -m "feat: dashboard + query API types"
```

---

## Task 5: `ui/lib/api.ts` — brokered OWOX calls

**Files:**
- Create: `ui/lib/api.ts`
- Test: `ui/lib/api.test.ts`

**Interfaces:**
- Consumes: types from Task 4; `owox` from `@owox/plugin-sdk`.
- Produces:
  - `listMarts(): Promise<MartRef[]>`
  - `getMartFields(id: string): Promise<MartField[]>`
  - `queryDataMart(id: string, body: QueryRequest): Promise<QueryResult>`

- [ ] **Step 1: Write the failing test**

Create `ui/lib/api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { owox } from '@owox/plugin-sdk';
import { listMarts, getMartFields, queryDataMart } from './api';

describe('api', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('queryDataMart POSTs to the query endpoint and returns the result', async () => {
    const result = { columns: ['a'], rows: [[1]], truncated: false, totals: null };
    const spy = vi.spyOn(owox, 'request').mockResolvedValue(result);

    const out = await queryDataMart('dm1', { fields: ['a'], limit: 10 });

    expect(spy).toHaveBeenCalledWith('POST', '/api/data-marts/dm1/query', { fields: ['a'], limit: 10 });
    expect(out).toEqual(result);
  });

  it('listMarts keeps only published, reportable marts', async () => {
    vi.spyOn(owox, 'request').mockResolvedValue([
      { id: '1', title: 'A', status: 'PUBLISHED', availableForReporting: true },
      { id: '2', title: 'B', status: 'DRAFT', availableForReporting: true },
      { id: '3', title: 'C', status: 'PUBLISHED', availableForReporting: false },
    ]);
    expect(await listMarts()).toEqual([{ id: '1', title: 'A' }]);
  });

  it('listMarts unwraps an { items } envelope', async () => {
    vi.spyOn(owox, 'request').mockResolvedValue({
      items: [{ id: '1', title: 'A', status: 'PUBLISHED', availableForReporting: true }],
    });
    expect(await listMarts()).toEqual([{ id: '1', title: 'A' }]);
  });

  it('getMartFields maps schema fields to roles and allowed aggregations', async () => {
    vi.spyOn(owox, 'request').mockResolvedValue({
      schema: {
        fields: [
          { name: 'Date', type: 'DATE', aggregationRole: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
          { name: 'Cost', type: 'FLOAT', aggregationRole: 'metric', allowedAggregations: ['SUM', 'AVG'] },
          { name: 'Src', type: 'STRING' },
        ],
      },
    });
    expect(await getMartFields('dm1')).toEqual([
      { name: 'Date', type: 'DATE', role: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
      { name: 'Cost', type: 'FLOAT', role: 'metric', allowedAggregations: ['SUM', 'AVG'] },
      // Falls back by type when the schema omits governance: string -> dimension.
      { name: 'Src', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT', 'COUNT_DISTINCT'] },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run ui/lib/api.test.ts --poolOptions.threads.maxThreads=4
```
Expected: FAIL — cannot resolve `./api`.

- [ ] **Step 3: Implement `ui/lib/api.ts`**

```ts
import { owox } from '@owox/plugin-sdk';
import type { AggregateFunction, MartField, MartRef, QueryRequest, QueryResult } from './types';

/** List routes wrap their array in different envelopes depending on the route; accept them all. */
function toArray<T>(res: unknown): T[] {
  const r = res as { items?: T[]; data?: T[]; rows?: T[] } | T[] | null | undefined;
  if (Array.isArray(r)) return r;
  return r?.items ?? r?.data ?? r?.rows ?? [];
}

const NUMERIC = /^(INT|FLOAT|NUMERIC|BIGNUMERIC|DECIMAL|DOUBLE|LONG)/i;
const TEMPORAL = /^(DATE|DATETIME|TIMESTAMP|TIME)$/i;

/** Governance defaults, applied only when the mart schema omits them. */
function defaultsFor(type: string): { role: MartField['role']; allowedAggregations: AggregateFunction[] } {
  if (NUMERIC.test(type)) return { role: 'metric', allowedAggregations: ['SUM', 'AVG', 'MIN', 'MAX'] };
  if (TEMPORAL.test(type)) return { role: 'dimension', allowedAggregations: ['MIN', 'MAX'] };
  return { role: 'dimension', allowedAggregations: ['COUNT', 'COUNT_DISTINCT'] };
}

/** Marts a dashboard may be built on. The broker has already filtered to what the user can see. */
export async function listMarts(): Promise<MartRef[]> {
  const res = await owox.request('GET', '/api/data-marts');
  return toArray<{ id: string; title?: string; status?: string; availableForReporting?: boolean }>(res)
    .filter(m => m.status === 'PUBLISHED' && m.availableForReporting)
    .map(m => ({ id: m.id, title: m.title ?? m.id }));
}

export async function getMartFields(id: string): Promise<MartField[]> {
  const res = (await owox.request('GET', `/api/data-marts/${id}`)) as {
    schema?: { fields?: Array<{ name: string; type: string; aggregationRole?: MartField['role']; allowedAggregations?: AggregateFunction[] }> };
  };
  return (res.schema?.fields ?? []).map(f => {
    const d = defaultsFor(f.type);
    return {
      name: f.name,
      type: f.type,
      role: f.aggregationRole ?? d.role,
      allowedAggregations: f.allowedAggregations ?? d.allowedAggregations,
    };
  });
}

/**
 * The ONE data call. Aggregation is entirely server-side: a projected field WITH an aggregation
 * rule is a metric, one WITHOUT is a grouping key. `totals` comes back computed over all matching
 * rows, ignoring `limit` — that is what scorecards read.
 */
export async function queryDataMart(id: string, body: QueryRequest): Promise<QueryResult> {
  return (await owox.request('POST', `/api/data-marts/${id}/query`, body)) as QueryResult;
}
```

- [ ] **Step 4: Make `owox.request` spy-able in the mock**

In `ui/sdk-mock.ts`, ensure `owox` is a concrete object (not a Proxy) so `vi.spyOn` works — copy the shape from `/Users/flakss/Projects/report-builder/ui/sdk-mock.ts`:

```ts
export const owox = {
  request: async (method: string, path: string, body?: unknown): Promise<unknown> => {
    console.info('[owox dev mock] owox.request', method, path, body);
    return null;
  },
};
export const collections = (name: string) => { /* Map-backed mock — see report-builder */ };
```

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run ui/lib/api.test.ts --poolOptions.threads.maxThreads=4
```
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add ui/lib/api.ts ui/lib/api.test.ts ui/sdk-mock.ts
git commit -m "feat: brokered OWOX api wrappers with server-side query"
```

---

## Task 6: `ui/lib/compile.ts` — component → query (THE CORE)

This is the heart of the plugin: it is the only place that knows the query API, and it guarantees no client-side math. Test it hard.

**Files:**
- Create: `ui/lib/compile.ts`
- Test: `ui/lib/compile.test.ts`

**Interfaces:**
- Consumes: `Component`, `FilterRule`, `QueryRequest` from Task 4.
- Produces: `compile(component: Component, filters: FilterRule[], slices: FilterRule[]): QueryRequest`
  and `aggLabel(column: string, fn: AggregateFunction): string`.

- [ ] **Step 1: Write the failing test**

Create `ui/lib/compile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compile, aggLabel } from './compile';
import type { Component, FilterRule } from './types';

const filters: FilterRule[] = [{ column: 'country', operator: 'eq', value: 'US' }];
const slices: FilterRule[] = [{ column: 'date', operator: 'relative_date', value: { kind: 'last_n_days', n: 30 } }];
const base = { id: 'c1', title: 'T', width: 1, height: 1 };

describe('aggLabel', () => {
  it('matches the backend label format', () => {
    expect(aggLabel('revenue', 'SUM')).toBe('revenue | SUM');
  });
  it('maps P50 to MEDIAN like the backend does', () => {
    expect(aggLabel('x', 'P50')).toBe('x | MEDIAN');
  });
});

describe('compile', () => {
  it('merges global filters (post-join) and slices (pre-join) into one filterConfig', () => {
    const c: Component = { ...base, type: 'scorecard', config: { metric: 'revenue', aggregation: 'SUM' } };
    const q = compile(c, filters, slices);
    expect(q.filterConfig).toEqual([
      { column: 'country', operator: 'eq', value: 'US', placement: 'post-join' },
      { column: 'date', operator: 'relative_date', value: { kind: 'last_n_days', n: 30 }, placement: 'pre-join' },
    ]);
  });

  it('scorecard: projects only the metric and aggregates it', () => {
    const c: Component = { ...base, type: 'scorecard', config: { metric: 'revenue', aggregation: 'SUM' } };
    const q = compile(c, [], []);
    expect(q.fields).toEqual(['revenue']);
    expect(q.aggregationConfig).toEqual([{ column: 'revenue', function: 'SUM' }]);
    expect(q.limit).toBe(1);
  });

  it('timeseries: buckets the date field and aggregates the metric', () => {
    const c: Component = {
      ...base, type: 'timeseries',
      config: { dateField: 'date', metric: 'cost', aggregation: 'SUM', unit: 'MONTH' },
    };
    const q = compile(c, [], []);
    expect(q.fields).toEqual(['date', 'cost']);
    expect(q.aggregationConfig).toEqual([{ column: 'cost', function: 'SUM' }]);
    expect(q.dateTruncConfig).toEqual([{ column: 'date', unit: 'MONTH' }]);
  });

  it('timeseries: includes the breakdown as an extra grouping key', () => {
    const c: Component = {
      ...base, type: 'timeseries',
      config: { dateField: 'date', metric: 'cost', aggregation: 'SUM', unit: 'DAY', breakdown: 'source' },
    };
    expect(compile(c, [], []).fields).toEqual(['date', 'cost', 'source']);
  });

  it('bar: groups by the dimension and honours the limit', () => {
    const c: Component = {
      ...base, type: 'bar',
      config: { dimension: 'source', metric: 'cost', aggregation: 'SUM', orientation: 'vertical', limit: 10 },
    };
    const q = compile(c, [], []);
    expect(q.fields).toEqual(['source', 'cost']);
    expect(q.aggregationConfig).toEqual([{ column: 'cost', function: 'SUM' }]);
    expect(q.limit).toBe(10);
    expect(q.dateTruncConfig).toBeNull();
  });

  it('pie: limits to maxCategories', () => {
    const c: Component = {
      ...base, type: 'pie',
      config: { dimension: 'country', metric: 'cost', aggregation: 'SUM', maxCategories: 6 },
    };
    expect(compile(c, [], []).limit).toBe(6);
  });

  it('table: projects the columns with NO aggregation (raw rows)', () => {
    const c: Component = {
      ...base, type: 'table',
      config: { columns: ['date', 'source', 'cost'], limit: 100 },
    };
    const q = compile(c, [], []);
    expect(q.fields).toEqual(['date', 'source', 'cost']);
    expect(q.aggregationConfig).toBeNull();   // no aggregations => no GROUP BY => raw rows
    expect(q.limit).toBe(100);
  });

  it('clamps limit to the service maximum of 1000', () => {
    const c: Component = { ...base, type: 'table', config: { columns: ['a'], limit: 99999 } };
    expect(compile(c, [], []).limit).toBe(1000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run ui/lib/compile.test.ts --poolOptions.threads.maxThreads=4
```
Expected: FAIL — cannot resolve `./compile`.

- [ ] **Step 3: Implement `ui/lib/compile.ts`**

```ts
import type {
  AggregateFunction, BarConfig, Component, FilterRule, PieConfig,
  QueryRequest, ScorecardConfig, TableConfig, TimeSeriesConfig,
} from './types';

/** The service caps a single query at 1000 rows. */
const MAX_LIMIT = 1000;

/** The backend labels an aggregated output column "<column> | <TOKEN>"; P50 renders as MEDIAN. */
export function aggLabel(column: string, fn: AggregateFunction): string {
  const token = fn === 'P50' ? 'MEDIAN' : fn;
  return `${column} | ${token}`;
}

const clamp = (n: number) => Math.max(1, Math.min(MAX_LIMIT, Math.trunc(n)));

/** Global slices are pre-join, global filters are post-join. Both are tagged and merged. */
function mergeFilters(filters: FilterRule[], slices: FilterRule[]): FilterRule[] | null {
  const merged = [
    ...filters.map(f => ({ ...f, placement: 'post-join' as const })),
    ...slices.map(f => ({ ...f, placement: 'pre-join' as const })),
  ];
  return merged.length ? merged : null;
}

/**
 * Compile a component into exactly one server-side query.
 *
 * Group-by is IMPLIED by the backend: a projected field WITH an aggregation rule is a metric; a
 * projected field WITHOUT one is a grouping key. A table therefore sends no aggregations at all.
 * Every field named in aggregationConfig/dateTruncConfig must also appear in `fields`.
 */
export function compile(component: Component, filters: FilterRule[], slices: FilterRule[]): QueryRequest {
  const filterConfig = mergeFilters(filters, slices);
  const q = (fields: string[], agg: QueryRequest['aggregationConfig'], limit: number, dateTrunc: QueryRequest['dateTruncConfig'] = null): QueryRequest => ({
    fields, filterConfig, aggregationConfig: agg, dateTruncConfig: dateTrunc, limit: clamp(limit),
  });

  switch (component.type) {
    case 'scorecard': {
      const c = component.config as ScorecardConfig;
      // The value is read from `totals` (computed over ALL matching rows), so one row is enough.
      return q([c.metric], [{ column: c.metric, function: c.aggregation }], 1);
    }
    case 'timeseries': {
      const c = component.config as TimeSeriesConfig;
      const fields = [c.dateField, c.metric, ...(c.breakdown ? [c.breakdown] : [])];
      return q(fields, [{ column: c.metric, function: c.aggregation }], MAX_LIMIT,
        [{ column: c.dateField, unit: c.unit }]);
    }
    case 'bar': {
      const c = component.config as BarConfig;
      return q([c.dimension, c.metric], [{ column: c.metric, function: c.aggregation }], c.limit);
    }
    case 'pie':
    case 'donut': {
      const c = component.config as PieConfig;
      return q([c.dimension, c.metric], [{ column: c.metric, function: c.aggregation }], c.maxCategories);
    }
    case 'table': {
      const c = component.config as TableConfig;
      // No aggregations => no GROUP BY => raw rows, which is what a detail table wants.
      return q(c.columns, null, c.limit);
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run ui/lib/compile.test.ts --poolOptions.threads.maxThreads=4
```
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/lib/compile.ts ui/lib/compile.test.ts
git commit -m "feat: compile dashboard components into server-side queries"
```

---

## Task 7: `ui/lib/dashboards.ts` — collections CRUD

**Files:**
- Create: `ui/lib/dashboards.ts`
- Test: `ui/lib/dashboards.test.ts`

**Interfaces:**
- Consumes: `Dashboard`, `emptyDashboard` from Task 4; `collections` from `@owox/plugin-sdk`.
- Produces:
  - `listDashboards(): Promise<Dashboard[]>`
  - `getDashboard(id: string): Promise<Dashboard | null>`
  - `saveDashboard(d: Dashboard): Promise<Dashboard>` — bumps `configVersion`
  - `deleteDashboard(id: string): Promise<void>`
  - `duplicateDashboard(d: Dashboard): Promise<Dashboard>`

- [ ] **Step 1: Write the failing test**

Create `ui/lib/dashboards.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { collections } from '@owox/plugin-sdk';
import { saveDashboard, duplicateDashboard, listDashboards } from './dashboards';
import { emptyDashboard } from './types';

describe('dashboards', () => {
  it('saveDashboard bumps configVersion and keeps the $entity mart binding', async () => {
    const put = vi.fn().mockImplementation((_id, doc) => Promise.resolve(doc));
    vi.spyOn({ collections }, 'collections');
    vi.mocked(collections).mockReturnValue({ put } as never);

    const d = { ...emptyDashboard('d1', 'mart1', 'A'), configVersion: 3 };
    const saved = await saveDashboard(d);

    expect(put).toHaveBeenCalledWith('d1', expect.objectContaining({
      id: 'd1',
      $entity: { type: 'data-mart', id: 'mart1' },
      configVersion: 4,
    }));
    expect(saved.configVersion).toBe(4);
  });

  it('duplicateDashboard produces a new id and a copied name', async () => {
    const put = vi.fn().mockImplementation((_id, doc) => Promise.resolve(doc));
    vi.mocked(collections).mockReturnValue({ put } as never);

    const source = emptyDashboard('d1', 'mart1', 'Sales');
    const copy = await duplicateDashboard(source);

    expect(copy.id).not.toBe('d1');
    expect(copy.name).toBe('Sales (copy)');
    expect(copy.$entity).toEqual({ type: 'data-mart', id: 'mart1' });
  });

  it('listDashboards returns whatever the host made visible', async () => {
    const list = vi.fn().mockResolvedValue([emptyDashboard('d1', 'm1', 'A')]);
    vi.mocked(collections).mockReturnValue({ list } as never);
    expect(await listDashboards()).toHaveLength(1);
  });
});
```

> Note: `collections` must be a plain exported function in `ui/sdk-mock.ts` for `vi.mocked` to work.
> If mocking proves awkward, use `vi.mock('@owox/plugin-sdk', ...)` at the top of the file instead —
> either is acceptable, the assertions are what matter.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run ui/lib/dashboards.test.ts --poolOptions.threads.maxThreads=4
```
Expected: FAIL — cannot resolve `./dashboards`.

- [ ] **Step 3: Implement `ui/lib/dashboards.ts`**

```ts
import { collections } from '@owox/plugin-sdk';
import type { Dashboard } from './types';

const COLLECTION = 'dashboards';
const db = () => collections(COLLECTION);

/**
 * The host filters `list()` by each doc's `$entity` ACL, so this returns exactly the dashboards
 * whose data mart the current user can access. There is no authz code in this plugin.
 */
export async function listDashboards(): Promise<Dashboard[]> {
  return (await db().list()) as Dashboard[];
}

export async function getDashboard(id: string): Promise<Dashboard | null> {
  return (await db().get(id)) as Dashboard | null;
}

/** Every save bumps configVersion — it is both the concurrency stamp and the refetch key. */
export async function saveDashboard(d: Dashboard): Promise<Dashboard> {
  const next = { ...d, configVersion: d.configVersion + 1 };
  return (await db().put(next.id, next)) as Dashboard;
}

export async function deleteDashboard(id: string): Promise<void> {
  await db().delete(id);
}

export async function duplicateDashboard(d: Dashboard): Promise<Dashboard> {
  const copy: Dashboard = {
    ...d,
    id: crypto.randomUUID(),
    name: `${d.name} (copy)`,
    configVersion: 0,
  };
  // Authorship fields are host-owned; drop the source's so the copy gets stamped fresh.
  delete copy.$createdBy; delete copy.$createdAt; delete copy.$updatedAt;
  return (await db().put(copy.id, copy)) as Dashboard;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run ui/lib/dashboards.test.ts --poolOptions.threads.maxThreads=4
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/lib/dashboards.ts ui/lib/dashboards.test.ts
git commit -m "feat: dashboards CRUD over host collections with \$entity ACL"
```

---

## Task 8: `ui/lib/freshness.ts` — loading / stale / refresh

Implements the spec's "show preload on chart if data is updating".

**Files:**
- Create: `ui/lib/freshness.ts`
- Test: `ui/lib/freshness.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const APPLY_DEBOUNCE_MS = 1000;
  export type LayerStatus = 'idle' | 'loading' | 'stale' | 'ready';
  export function useLayerData<T>(
    configVersion: number, enabled: boolean, fetcher: () => Promise<T>, debounceMs?: number
  ): { data: T | null; status: LayerStatus; error: string | null; refresh: () => void };
  ```

- [ ] **Step 1: Write the failing test**

Create `ui/lib/freshness.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLayerData } from './freshness';

describe('useLayerData', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fetches after the debounce and lands in ready with data', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: 1 });
    const { result } = renderHook(() => useLayerData(1, true, fetcher, 1000));

    expect(fetcher).not.toHaveBeenCalled();       // debounced, not immediate
    await act(async () => { vi.advanceTimersByTime(1000); });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data).toEqual({ ok: 1 });
  });

  it('does not fetch while disabled, and reports stale', async () => {
    const fetcher = vi.fn();
    const { result } = renderHook(() => useLayerData(1, false, fetcher, 1000));
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.status).toBe('stale');
  });

  it('refetches when configVersion changes', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: 1 });
    const { rerender } = renderHook(({ v }) => useLayerData(v, true, fetcher, 1000), {
      initialProps: { v: 1 },
    });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(fetcher).toHaveBeenCalledTimes(1);

    rerender({ v: 2 });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good data and reports stale on error', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: 1 })
      .mockRejectedValueOnce(new Error('boom'));
    const { result, rerender } = renderHook(({ v }) => useLayerData(v, true, fetcher, 1000), {
      initialProps: { v: 1 },
    });
    await act(async () => { vi.advanceTimersByTime(1000); });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    rerender({ v: 2 });
    await act(async () => { vi.advanceTimersByTime(1000); });

    await waitFor(() => expect(result.current.status).toBe('stale'));
    expect(result.current.data).toEqual({ ok: 1 });   // last good data survives
    expect(result.current.error).toBe('boom');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run ui/lib/freshness.test.ts --poolOptions.threads.maxThreads=4
```
Expected: FAIL — cannot resolve `./freshness`.

- [ ] **Step 3: Implement `ui/lib/freshness.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

/** Config edits apply (and refetch) after this idle delay, so dragging a slider isn't N queries. */
export const APPLY_DEBOUNCE_MS = 1000;

export type LayerStatus = 'idle' | 'loading' | 'stale' | 'ready';

/**
 * One component's data lifecycle. Refetch is keyed on `configVersion` and debounced. While a
 * refetch is in flight the previous `data` is retained, so the component shows its last-good
 * render under a progress indicator instead of flashing empty. Errors keep the last-good data too
 * and surface as `stale` with a `refresh()` affordance.
 */
export function useLayerData<T>(
  configVersion: number,
  enabled: boolean,
  fetcher: () => Promise<T>,
  debounceMs: number = APPLY_DEBOUNCE_MS
) {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<LayerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Keep the latest fetcher without making it a re-run trigger (it's a new closure every render).
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(() => setNonce(n => n + 1), []);

  useEffect(() => {
    if (!enabled) { setStatus('stale'); return; }

    let cancelled = false;
    setStatus('loading');
    const timer = setTimeout(() => {
      fetcherRef.current()
        .then(result => {
          if (cancelled) return;
          setData(result);
          setError(null);
          setStatus('ready');
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
          setStatus('stale');   // last-good `data` is deliberately retained
        });
    }, debounceMs);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [configVersion, enabled, debounceMs, nonce]);

  return { data, status, error, refresh };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run ui/lib/freshness.test.ts --poolOptions.threads.maxThreads=4
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/lib/freshness.ts ui/lib/freshness.test.ts
git commit -m "feat: useLayerData loading/stale/refresh with debounced refetch"
```

---

## Task 9: `ui/lib/generate.ts` — auto-generate a dashboard

**Files:**
- Create: `ui/lib/generate.ts`
- Test: `ui/lib/generate.test.ts`

**Interfaces:**
- Consumes: `MartField`, `Dashboard`, `Component`, `emptyDashboard` (Task 4); `queryDataMart` (Task 5).
- Produces:
  - `probeCardinality(martId: string, dimensions: MartField[]): Promise<Record<string, number>>`
  - `generate(martId: string, martTitle: string, fields: MartField[], cardinality: Record<string, number>): Dashboard`
  - `PIE_MAX_CATEGORIES = 8`

- [ ] **Step 1: Write the failing test**

Create `ui/lib/generate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generate, PIE_MAX_CATEGORIES } from './generate';
import type { MartField } from './types';

const fields: MartField[] = [
  { name: 'Date', type: 'DATE', role: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
  { name: 'Cost', type: 'FLOAT', role: 'metric', allowedAggregations: ['SUM', 'AVG'] },
  { name: 'Clicks', type: 'INTEGER', role: 'metric', allowedAggregations: ['SUM'] },
  { name: 'Source', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT'] },
  { name: 'Campaign', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT'] },
];
const cardinality = { Source: 4, Campaign: 250 };   // low vs high

describe('generate', () => {
  const d = generate('m1', 'AD COST', fields, cardinality);

  it('binds the dashboard to exactly one data mart via $entity', () => {
    expect(d.$entity).toEqual({ type: 'data-mart', id: 'm1' });
    expect(d.gridColumns).toBe(5);
  });

  it('adds a global date slice for the date field', () => {
    expect(d.slices).toEqual([
      { column: 'Date', operator: 'relative_date', value: { kind: 'last_n_days', n: 30 } },
    ]);
  });

  it('emits at most 5 scorecards, one per metric, full-width-fifth each', () => {
    const cards = d.components.filter(c => c.type === 'scorecard');
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(5);
    expect(cards[0].width).toBe(1);
    expect(cards[0].config).toEqual({ metric: 'Cost', aggregation: 'SUM' });
  });

  it('emits a full-width DAY time series when a date field exists', () => {
    const ts = d.components.find(c => c.type === 'timeseries');
    expect(ts).toBeDefined();
    expect(ts!.width).toBe(5);
    expect(ts!.config).toMatchObject({ dateField: 'Date', metric: 'Cost', unit: 'DAY', aggregation: 'SUM' });
  });

  it('uses a pie ONLY for the low-cardinality dimension', () => {
    const pie = d.components.find(c => c.type === 'pie');
    expect(pie!.config).toMatchObject({ dimension: 'Source' });
    expect(cardinality.Source).toBeLessThanOrEqual(PIE_MAX_CATEGORIES);
  });

  it('uses a bar (never a pie) for the high-cardinality dimension', () => {
    const bars = d.components.filter(c => c.type === 'bar');
    expect(bars.some(b => (b.config as { dimension: string }).dimension === 'Campaign')).toBe(true);
    const pies = d.components.filter(c => c.type === 'pie');
    expect(pies.some(p => (p.config as { dimension: string }).dimension === 'Campaign')).toBe(false);
  });

  it('ends with a full-width detail table over every field', () => {
    const last = d.components[d.components.length - 1];
    expect(last.type).toBe('table');
    expect(last.width).toBe(5);
    expect((last.config as { columns: string[] }).columns).toEqual(fields.map(f => f.name));
  });

  it('produces components in the spec order: scorecards, timeseries, bars, pie, table', () => {
    const order = [...new Set(d.components.map(c => c.type))];
    expect(order).toEqual(['scorecard', 'timeseries', 'bar', 'pie', 'table']);
  });

  it('generates nothing but a table when the mart has no metrics', () => {
    const only = generate('m1', 'X', [fields[3]], { Source: 3 });
    expect(only.components.every(c => c.type === 'table' || c.type === 'pie')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run ui/lib/generate.test.ts --poolOptions.threads.maxThreads=4
```
Expected: FAIL — cannot resolve `./generate`.

- [ ] **Step 3: Implement `ui/lib/generate.ts`**

```ts
import { queryDataMart } from './api';
import { emptyDashboard } from './types';
import type { AggregateFunction, Component, Dashboard, MartField } from './types';

/** A pie is only readable up to this many slices; above it, a ranked bar wins. */
export const PIE_MAX_CATEGORIES = 8;
const MAX_SCORECARDS = 5;
const BAR_LIMIT = 10;
const TABLE_LIMIT = 100;

const isDate = (f: MartField) => /^(DATE|DATETIME|TIMESTAMP)$/i.test(f.type);
const pick = (f: MartField, ...prefer: AggregateFunction[]): AggregateFunction =>
  prefer.find(p => f.allowedAggregations.includes(p)) ?? f.allowedAggregations[0] ?? 'COUNT';

const uid = () => crypto.randomUUID();

/**
 * Distinct-count each candidate dimension, server-side, to decide pie-vs-bar. This is the spec's
 * "data sampling" step — it is an aggregated query, not a client-side calculation.
 */
export async function probeCardinality(
  martId: string,
  dimensions: MartField[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const dim of dimensions) {
    try {
      const res = await queryDataMart(martId, {
        fields: [dim.name],
        aggregationConfig: null,   // project the dimension alone; grouping is implied
        limit: PIE_MAX_CATEGORIES + 1,
      });
      // `truncated` means there were MORE groups than we asked for -> high cardinality.
      out[dim.name] = res.truncated ? Number.POSITIVE_INFINITY : res.rows.length;
    } catch {
      out[dim.name] = Number.POSITIVE_INFINITY;   // unknown -> treat as high, prefer a bar
    }
  }
  return out;
}

/**
 * Turn a mart's schema (+ cardinality probes) into a starting dashboard. Deterministic.
 * Order follows the spec: date filters, scorecards, time series, bars, pie, table.
 */
export function generate(
  martId: string,
  martTitle: string,
  fields: MartField[],
  cardinality: Record<string, number>
): Dashboard {
  const d = emptyDashboard(uid(), martId, martTitle);
  const dates = fields.filter(isDate);
  const metrics = fields.filter(f => f.role === 'metric');
  const dims = fields.filter(f => f.role === 'dimension' && !isDate(f));

  // 2. Global date slice (pre-join) for each date field.
  d.slices = dates.map(f => ({
    column: f.name,
    operator: 'relative_date',
    value: { kind: 'last_n_days', n: 30 },
  }));

  const components: Component[] = [];
  const add = (c: Omit<Component, 'id'>) => components.push({ ...c, id: uid() });

  // 3. Up to five scorecards.
  for (const m of metrics.slice(0, MAX_SCORECARDS)) {
    add({
      type: 'scorecard', title: m.name, width: 1, height: 1,
      config: { metric: m.name, aggregation: pick(m, 'SUM', 'AVG', 'COUNT') },
    });
  }

  // 4. Time series over the primary date field.
  const primaryDate = dates[0];
  const primaryMetric = metrics[0];
  if (primaryDate && primaryMetric) {
    add({
      type: 'timeseries', title: `${primaryMetric.name} over time`, width: 5, height: 2,
      config: {
        dateField: primaryDate.name, metric: primaryMetric.name,
        aggregation: pick(primaryMetric, 'SUM', 'AVG'), unit: 'DAY',
      },
    });
  }

  // 5. Bars for high-cardinality dimensions; 6. pies only for genuinely low-cardinality ones.
  if (primaryMetric) {
    const agg = pick(primaryMetric, 'SUM', 'AVG');
    for (const dim of dims.filter(x => (cardinality[x.name] ?? Infinity) > PIE_MAX_CATEGORIES)) {
      add({
        type: 'bar', title: `${primaryMetric.name} by ${dim.name}`, width: 3, height: 2,
        config: {
          dimension: dim.name, metric: primaryMetric.name, aggregation: agg,
          orientation: 'vertical', limit: BAR_LIMIT, sort: 'desc',
        },
      });
    }
    for (const dim of dims.filter(x => (cardinality[x.name] ?? Infinity) <= PIE_MAX_CATEGORIES)) {
      add({
        type: 'pie', title: `${primaryMetric.name} by ${dim.name}`, width: 2, height: 2,
        config: {
          dimension: dim.name, metric: primaryMetric.name, aggregation: agg,
          maxCategories: PIE_MAX_CATEGORIES,
        },
      });
    }
  }

  // 7. Detail table.
  add({
    type: 'table', title: 'Details', width: 5, height: 3,
    config: { columns: fields.map(f => f.name), limit: TABLE_LIMIT },
  });

  d.components = components;
  d.generatedAt = new Date().toISOString();
  return d;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run ui/lib/generate.test.ts --poolOptions.threads.maxThreads=4
```
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/lib/generate.ts ui/lib/generate.test.ts
git commit -m "feat: auto-generate a dashboard from mart schema + cardinality probes"
```

---

## Task 10: `ui/lib/format.ts` + `ui/lib/filterOps.ts`

**Files:**
- Create: `ui/lib/format.ts`, `ui/lib/filterOps.ts`
- Test: `ui/lib/format.test.ts`, `ui/lib/filterOps.test.ts`

**Interfaces:**
- Produces:
  - `formatNumber(v: unknown): string` — presentation only.
  - `formatDelta(current: number, previous: number): { abs: number; pct: number; trend: 'up'|'down'|'flat' }`
  - `operatorsFor(type: string): string[]`
  - `RELATIVE_PRESETS: { kind: string; label: string; needsN: boolean }[]`
  - `valueKind(operator: string): 'scalar' | 'between' | 'relative' | 'none'`

- [ ] **Step 1: Write the failing tests**

`ui/lib/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatNumber, formatDelta } from './format';

describe('formatNumber', () => {
  it('groups thousands and trims to two decimals', () => {
    expect(formatNumber(1234567.891)).toBe('1,234,567.89');
  });
  it('passes through non-numbers as text', () => {
    expect(formatNumber('abc')).toBe('abc');
    expect(formatNumber(null)).toBe('—');
  });
});

describe('formatDelta', () => {
  it('computes absolute and percentage change with an up trend', () => {
    expect(formatDelta(150, 100)).toEqual({ abs: 50, pct: 50, trend: 'up' });
  });
  it('reports a down trend', () => {
    expect(formatDelta(50, 100)).toEqual({ abs: -50, pct: -50, trend: 'down' });
  });
  it('treats a zero previous value as flat rather than dividing by zero', () => {
    expect(formatDelta(10, 0)).toEqual({ abs: 10, pct: 0, trend: 'flat' });
  });
});
```

`ui/lib/filterOps.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { operatorsFor, valueKind, RELATIVE_PRESETS } from './filterOps';

describe('operatorsFor', () => {
  it('never offers `in`/`not_in` — the query service rejects them', () => {
    for (const t of ['STRING', 'INTEGER', 'DATE', 'BOOLEAN']) {
      expect(operatorsFor(t)).not.toContain('in');
      expect(operatorsFor(t)).not.toContain('not_in');
    }
  });
  it('offers relative_date only for temporal types', () => {
    expect(operatorsFor('DATE')).toContain('relative_date');
    expect(operatorsFor('STRING')).not.toContain('relative_date');
  });
  it('offers substring operators only for strings', () => {
    expect(operatorsFor('STRING')).toContain('contains');
    expect(operatorsFor('INTEGER')).not.toContain('contains');
  });
});

describe('valueKind', () => {
  it('classifies operator value shapes', () => {
    expect(valueKind('between')).toBe('between');
    expect(valueKind('relative_date')).toBe('relative');
    expect(valueKind('is_null')).toBe('none');
    expect(valueKind('eq')).toBe('scalar');
  });
});

describe('RELATIVE_PRESETS', () => {
  it('excludes this_week, which the service rejects', () => {
    expect(RELATIVE_PRESETS.map(p => p.kind)).not.toContain('this_week');
  });
  it('includes the supported presets', () => {
    expect(RELATIVE_PRESETS.map(p => p.kind)).toEqual(
      expect.arrayContaining(['today', 'yesterday', 'this_month', 'last_month', 'this_year', 'last_n_days', 'last_n_months'])
    );
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run ui/lib/format.test.ts ui/lib/filterOps.test.ts --poolOptions.threads.maxThreads=4
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `ui/lib/format.ts`**

```ts
/** Presentation only. All aggregation happens server-side. */
export function formatNumber(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Period-over-period comparison for a scorecard. Both values come from the server. */
export function formatDelta(current: number, previous: number) {
  const abs = current - previous;
  // A zero baseline has no meaningful percentage, and no defensible direction: report flat
  // rather than Infinity/NaN.
  if (previous === 0) return { abs, pct: 0, trend: 'flat' as const };
  const pct = (abs / Math.abs(previous)) * 100;
  const trend: 'up' | 'down' | 'flat' = abs === 0 ? 'flat' : abs > 0 ? 'up' : 'down';
  return { abs, pct, trend };
}
```

- [ ] **Step 4: Implement `ui/lib/filterOps.ts`**

```ts
/**
 * The operator catalogue the UI may offer. It is deliberately NARROWER than the backend's schema:
 * `in`, `not_in`, `in_next_n_days` and `this_week` are rejected by the query service, so they are
 * never offered. That is why there are no multi-select dimension filters in v1.
 */
const NUMBER = /^(INT|FLOAT|NUMERIC|BIGNUMERIC|DECIMAL|DOUBLE|LONG)/i;
const TEMPORAL = /^(DATE|DATETIME|TIMESTAMP|TIME)$/i;
const BOOLEAN = /^BOOL/i;

const OPERATORS = {
  string: ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty', 'is_null', 'is_not_null'],
  number: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'between', 'is_null', 'is_not_null'],
  datetime: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'between', 'relative_date', 'is_null', 'is_not_null'],
  boolean: ['is_true', 'is_false', 'is_null', 'is_not_null'],
} as const;

export function operatorsFor(type: string): string[] {
  if (NUMBER.test(type)) return [...OPERATORS.number];
  if (TEMPORAL.test(type)) return [...OPERATORS.datetime];
  if (BOOLEAN.test(type)) return [...OPERATORS.boolean];
  return [...OPERATORS.string];
}

const UNARY = new Set(['is_empty', 'is_not_empty', 'is_null', 'is_not_null', 'is_true', 'is_false']);

export function valueKind(operator: string): 'scalar' | 'between' | 'relative' | 'none' {
  if (operator === 'between') return 'between';
  if (operator === 'relative_date') return 'relative';
  if (UNARY.has(operator)) return 'none';
  return 'scalar';
}

/** `this_week` is intentionally absent — the query service rejects it. */
export const RELATIVE_PRESETS: { kind: string; label: string; needsN: boolean }[] = [
  { kind: 'today', label: 'Today', needsN: false },
  { kind: 'yesterday', label: 'Yesterday', needsN: false },
  { kind: 'last_n_days', label: 'Last N days', needsN: true },
  { kind: 'this_month', label: 'This month', needsN: false },
  { kind: 'last_month', label: 'Last month', needsN: false },
  { kind: 'last_n_months', label: 'Last N months', needsN: true },
  { kind: 'this_year', label: 'This year', needsN: false },
];
```

- [ ] **Step 5: Run to verify they pass**

```bash
npx vitest run ui/lib/format.test.ts ui/lib/filterOps.test.ts --poolOptions.threads.maxThreads=4
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/lib/format.ts ui/lib/filterOps.ts ui/lib/format.test.ts ui/lib/filterOps.test.ts
git commit -m "feat: formatting helpers and the supported filter-operator catalogue"
```

---

## Task 11: Dashboard list + create flow

**Files:**
- Create: `ui/components/DashboardList.tsx`, `ui/components/CreateDashboardDialog.tsx`
- Modify: `ui/App.tsx` (routing)
- Test: `ui/components/DashboardList.test.tsx`

**Interfaces:**
- Consumes: `listDashboards`, `deleteDashboard`, `duplicateDashboard` (Task 7); `listMarts`, `getMartFields` (Task 5); `generate`, `probeCardinality` (Task 9).
- Produces: `<DashboardList />` and a create flow that picks a mart → generates → saves → navigates to `/d/:id`.

- [ ] **Step 1: Write the failing test**

Create `ui/components/DashboardList.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardList } from './DashboardList';
import * as db from '../lib/dashboards';
import { emptyDashboard } from '../lib/types';

describe('DashboardList', () => {
  it('renders each dashboard the host made visible', async () => {
    vi.spyOn(db, 'listDashboards').mockResolvedValue([
      { ...emptyDashboard('d1', 'm1', 'Sales'), $createdBy: 'u1', $updatedAt: '2026-07-01T00:00:00Z' },
    ]);
    render(<MemoryRouter><DashboardList /></MemoryRouter>);
    expect(await screen.findByText('Sales')).toBeInTheDocument();
  });

  it('shows an empty state when there are none', async () => {
    vi.spyOn(db, 'listDashboards').mockResolvedValue([]);
    render(<MemoryRouter><DashboardList /></MemoryRouter>);
    expect(await screen.findByText(/no dashboards/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run ui/components/DashboardList.test.tsx --poolOptions.threads.maxThreads=4
```
Expected: FAIL — cannot resolve `./DashboardList`.

- [ ] **Step 3: Implement `ui/components/DashboardList.tsx`**

Render inside the mandatory chrome. Columns: Name, Author (`$createdBy`), Created (`$createdAt`), Modified (`$updatedAt`). Row actions: Open, Duplicate, Delete. A "New dashboard" button opens `CreateDashboardDialog`.

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listDashboards, deleteDashboard, duplicateDashboard } from '../lib/dashboards';
import type { Dashboard } from '../lib/types';
import { CreateDashboardDialog } from './CreateDashboardDialog';

export function DashboardList() {
  const [items, setItems] = useState<Dashboard[] | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = () => { void listDashboards().then(setItems); };
  useEffect(reload, []);

  return (
    <div className="dm-page text-foreground">
      <header className="dm-page-header">
        <h1 className="dm-page-header-title">Dashboards</h1>
      </header>
      <div className="dm-page-content">
        <div className="dm-card">
          <div className="flex justify-end p-4">
            <button className="rounded border px-3 py-1.5 text-sm" onClick={() => setCreating(true)}>
              New dashboard
            </button>
          </div>

          {items === null && <p className="p-6 text-sm">Loading…</p>}
          {items?.length === 0 && <p className="p-6 text-sm">No dashboards yet.</p>}

          {items && items.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="p-3">Name</th><th className="p-3">Author</th>
                  <th className="p-3">Modified</th><th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {items.map(d => (
                  <tr key={d.id} className="border-t">
                    <td className="p-3"><Link to={`/d/${d.id}`}>{d.name}</Link></td>
                    <td className="p-3">{d.$createdBy ?? '—'}</td>
                    <td className="p-3">{d.$updatedAt?.slice(0, 10) ?? '—'}</td>
                    <td className="p-3 text-right">
                      <button className="mr-2" onClick={() => void duplicateDashboard(d).then(reload)}>Duplicate</button>
                      <button onClick={() => void deleteDashboard(d.id).then(reload)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {creating && <CreateDashboardDialog onClose={() => { setCreating(false); reload(); }} />}
    </div>
  );
}
```

- [ ] **Step 4: Implement `ui/components/CreateDashboardDialog.tsx`**

Pick a mart, then: `getMartFields` → `probeCardinality` (dimensions only) → `generate` → `saveDashboard` → navigate to `/d/:id`. Show a spinner while probing, because the probes are real queries.

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listMarts, getMartFields } from '../lib/api';
import { generate, probeCardinality } from '../lib/generate';
import { saveDashboard } from '../lib/dashboards';
import type { MartRef } from '../lib/types';

export function CreateDashboardDialog({ onClose }: { onClose: () => void }) {
  const [marts, setMarts] = useState<MartRef[]>([]);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => { void listMarts().then(setMarts); }, []);

  async function create(mart: MartRef) {
    setBusy(true);
    try {
      const fields = await getMartFields(mart.id);
      const dims = fields.filter(f => f.role === 'dimension' && !/^(DATE|DATETIME|TIMESTAMP)$/i.test(f.type));
      const cardinality = await probeCardinality(mart.id, dims);
      const saved = await saveDashboard(generate(mart.id, mart.title, fields, cardinality));
      navigate(`/d/${saved.id}`);
    } finally {
      setBusy(false);
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/40" role="dialog">
      <div className="dm-card w-[28rem] p-4">
        <h2 className="mb-3 text-base font-medium">Choose a data mart</h2>
        {busy && <p className="text-sm">Analysing the data mart…</p>}
        {!busy && (
          <ul className="max-h-80 overflow-auto">
            {marts.map(m => (
              <li key={m.id}>
                <button className="w-full p-2 text-left text-sm hover:bg-black/5" onClick={() => void create(m)}>
                  {m.title}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button className="mt-3 text-sm" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire routing in `ui/App.tsx`**

```tsx
import { Routes, Route, MemoryRouter } from 'react-router-dom';
import { DashboardList } from './components/DashboardList';
import { DashboardView } from './components/DashboardView';

export function App() {
  return (
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<DashboardList />} />
        <Route path="/d/:id" element={<DashboardView />} />
      </Routes>
    </MemoryRouter>
  );
}
```
Use `MemoryRouter` — the plugin renders in a sandboxed iframe and must not fight the host for the URL bar. `react-router-dom` is host-provided; keep it external.

- [ ] **Step 6: Run tests + host build probe**

```bash
npx vitest run ui/components/DashboardList.test.tsx --poolOptions.threads.maxThreads=4
npx esbuild ui/main.tsx --bundle --format=esm --external:react --external:react-dom \
  --external:react-dom/client --external:react/jsx-runtime --external:react-router-dom \
  --external:@owox/plugin-sdk --outfile=/tmp/probe.js
```
Expected: tests PASS; probe succeeds.

- [ ] **Step 7: Commit**

```bash
git add ui/components/DashboardList.tsx ui/components/CreateDashboardDialog.tsx ui/components/DashboardList.test.tsx ui/App.tsx
git commit -m "feat: dashboard list, create-from-mart flow, routing"
```

---

## Task 12: Grid + DashboardView + global FilterBar

**Files:**
- Create: `ui/components/Grid.tsx`, `ui/components/DashboardView.tsx`, `ui/components/FilterBar.tsx`, `ui/components/ComponentCard.tsx`
- Test: `ui/components/Grid.test.tsx`

**Interfaces:**
- Consumes: `getDashboard`, `saveDashboard` (Task 7); `useLayerData` (Task 8); `compile` (Task 6); `queryDataMart` (Task 5).
- Produces:
  - `<Grid dashboard={...}>{(component) => ReactNode}</Grid>` — lays components out on the N-column grid honouring `width` and `height`.
  - `<ComponentCard component status error onRefresh>` — the card chrome + preload overlay.
  - `<DashboardView />` — loads the doc, owns global filter state, renders the grid.
  - `useComponentData(dashboard, component)` → `{ data, status, error, refresh }`.

- [ ] **Step 1: Write the failing test**

Create `ui/components/Grid.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Grid } from './Grid';
import { emptyDashboard } from '../lib/types';
import type { Dashboard } from '../lib/types';

function dash(): Dashboard {
  return {
    ...emptyDashboard('d1', 'm1', 'D'),
    gridColumns: 5,
    components: [
      { id: 'a', type: 'scorecard', title: 'A', width: 1, height: 1, config: { metric: 'x', aggregation: 'SUM' } },
      { id: 'b', type: 'table', title: 'B', width: 5, height: 3, config: { columns: ['x'], limit: 10 } },
    ],
  };
}

describe('Grid', () => {
  it('spans each component by its width and height', () => {
    render(<Grid dashboard={dash()}>{c => <div data-testid={c.id}>{c.title}</div>}</Grid>);
    expect(screen.getByTestId('a').parentElement).toHaveStyle({ gridColumn: 'span 1', gridRow: 'span 1' });
    expect(screen.getByTestId('b').parentElement).toHaveStyle({ gridColumn: 'span 5', gridRow: 'span 3' });
  });

  it('clamps a width larger than the grid to the column count', () => {
    const d = dash();
    d.components[0].width = 99;
    render(<Grid dashboard={d}>{c => <div data-testid={c.id} />}</Grid>);
    expect(screen.getByTestId('a').parentElement).toHaveStyle({ gridColumn: 'span 5' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run ui/components/Grid.test.tsx --poolOptions.threads.maxThreads=4
```
Expected: FAIL — cannot resolve `./Grid`.

- [ ] **Step 3: Implement `ui/components/Grid.tsx`**

```tsx
import type { ReactNode } from 'react';
import type { Component, Dashboard } from '../lib/types';

/**
 * The N-column grid (default 5). A component spans `width` columns and `height` rows, so the only
 * legal widths are 1..gridColumns — 20/40/60/80/100% at the default. Arbitrary widths are impossible
 * by construction. On narrow screens the grid collapses to a single column, preserving order.
 */
export function Grid({
  dashboard,
  children,
}: {
  dashboard: Dashboard;
  children: (component: Component) => ReactNode;
}) {
  const cols = Math.max(1, dashboard.gridColumns);
  return (
    <div
      className="dmd-grid grid gap-4"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: '7rem' }}
    >
      {dashboard.components.map(c => (
        <div
          key={c.id}
          style={{
            gridColumn: `span ${Math.min(Math.max(1, c.width), cols)}`,
            gridRow: `span ${Math.max(1, c.height)}`,
          }}
        >
          {children(c)}
        </div>
      ))}
    </div>
  );
}
```

Add the responsive collapse to `ui/styles.src.css` (then re-run `npm run css`):
```css
@media (max-width: 768px) {
  .dmd-grid { grid-template-columns: 1fr !important; }
  .dmd-grid > * { grid-column: span 1 !important; }
}
```

- [ ] **Step 4: Implement `ui/components/ComponentCard.tsx`**

The preload affordance required by the spec: while refetching, keep the last-good render at 50% opacity behind a progress line; on error, offer Refresh.

```tsx
import type { ReactNode } from 'react';
import type { LayerStatus } from '../lib/freshness';

export function ComponentCard({
  title, status, error, onRefresh, children,
}: {
  title: string; status: LayerStatus; error: string | null;
  onRefresh: () => void; children: ReactNode;
}) {
  const busy = status === 'loading';
  return (
    <div className="dm-card relative flex h-full flex-col overflow-hidden">
      {busy && <div className="dmd-progress" aria-label="Updating" />}
      <div className="px-4 pt-3 text-sm font-medium">{title}</div>
      <div className={`flex-1 p-4 ${busy ? 'pointer-events-none opacity-50' : ''}`}>{children}</div>
      {status === 'stale' && error && (
        <div className="absolute inset-0 grid place-items-center bg-black/5">
          <button className="rounded border bg-white px-3 py-1 text-sm" onClick={onRefresh}>Refresh</button>
        </div>
      )}
    </div>
  );
}
```

Add to `ui/styles.src.css` (then `npm run css`):
```css
.dmd-progress { position:absolute; top:0; left:0; height:2px; width:100%; overflow:hidden; background:rgba(0,0,0,.06); }
.dmd-progress::after { content:''; position:absolute; inset-block:0; width:40%; background:var(--chart-1); animation: dmd-slide 1.1s infinite; }
@keyframes dmd-slide { from { left:-40% } to { left:100% } }
```

- [ ] **Step 5: Implement `ui/components/DashboardView.tsx`**

Owns global filter state; every component gets one query via `compile`; refetch is keyed on `configVersion`.

```tsx
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getDashboard, saveDashboard } from '../lib/dashboards';
import { queryDataMart } from '../lib/api';
import { compile } from '../lib/compile';
import { useLayerData } from '../lib/freshness';
import { Grid } from './Grid';
import { ComponentCard } from './ComponentCard';
import { FilterBar } from './FilterBar';
import { renderComponent } from './renderComponent';
import type { Component, Dashboard, FilterRule } from '../lib/types';

/** One component = one server-side query. Refetch is keyed on the doc's configVersion. */
export function useComponentData(dashboard: Dashboard, component: Component) {
  const fetcher = useCallback(
    () => queryDataMart(dashboard.$entity.id, compile(component, dashboard.filters, dashboard.slices)),
    [dashboard, component]
  );
  return useLayerData(dashboard.configVersion, true, fetcher);
}

function Cell({ dashboard, component }: { dashboard: Dashboard; component: Component }) {
  const { data, status, error, refresh } = useComponentData(dashboard, component);
  return (
    <ComponentCard title={component.title} status={status} error={error} onRefresh={refresh}>
      {renderComponent(component, data)}
    </ComponentCard>
  );
}

export function DashboardView() {
  const { id } = useParams<{ id: string }>();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);

  useEffect(() => { if (id) void getDashboard(id).then(setDashboard); }, [id]);

  // A filter change bumps configVersion, which refetches EVERY component. Filters are global.
  const applyFilters = (filters: FilterRule[], slices: FilterRule[]) => {
    setDashboard(d => (d ? { ...d, filters, slices, configVersion: d.configVersion + 1 } : d));
  };

  if (!dashboard) return <div className="dm-page"><div className="dm-page-content">Loading…</div></div>;

  return (
    <div className="dm-page text-foreground">
      <header className="dm-page-header">
        <h1 className="dm-page-header-title">{dashboard.name}</h1>
      </header>
      <div className="dm-page-content space-y-4">
        <FilterBar dashboard={dashboard} onChange={applyFilters} />
        <Grid dashboard={dashboard}>
          {c => <Cell key={c.id} dashboard={dashboard} component={c} />}
        </Grid>
        <button
          className="rounded border px-3 py-1.5 text-sm"
          onClick={() => void saveDashboard(dashboard).then(setDashboard)}
        >
          Save
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Implement `ui/components/FilterBar.tsx`**

One control per date slice, laid out in a single horizontal row (wrapping when narrow), each labelled with the mart field it controls. Presets come from `RELATIVE_PRESETS` (Task 10). Changing one calls `onChange` with the updated global `filters`/`slices`. Include a "Reset filters" button that restores the generated slices.

- [ ] **Step 7: Run tests + probe**

```bash
npx vitest run ui/components --poolOptions.threads.maxThreads=4
npm run typecheck
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add ui/components/Grid.tsx ui/components/Grid.test.tsx ui/components/DashboardView.tsx ui/components/ComponentCard.tsx ui/components/FilterBar.tsx ui/styles.src.css ui/styles.css
git commit -m "feat: responsive grid, dashboard view, global filter bar, preload states"
```

---

## Task 13: Scorecard + DataTable renderers

**Files:**
- Create: `ui/components/Scorecard.tsx`, `ui/components/DataTable.tsx`, `ui/components/renderComponent.tsx`
- Test: `ui/components/Scorecard.test.tsx`

**Interfaces:**
- Consumes: `QueryResult`, `Component` (Task 4); `aggLabel` (Task 6); `formatNumber` (Task 10).
- Produces: `renderComponent(component: Component, data: QueryResult | null): ReactNode`.

- [ ] **Step 1: Write the failing test**

Create `ui/components/Scorecard.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Scorecard } from './Scorecard';
import type { Component, QueryResult } from '../lib/types';

const component: Component = {
  id: 'c', type: 'scorecard', title: 'Cost', width: 1, height: 1,
  config: { metric: 'Cost', aggregation: 'SUM' },
};

describe('Scorecard', () => {
  it('reads the value from server-computed totals, not from rows', () => {
    const data: QueryResult = {
      columns: ['Cost | SUM'], rows: [[999]],   // rows are a red herring
      truncated: false, totals: { 'Cost | SUM': 1234567.89 },
    };
    render(<Scorecard component={component} data={data} />);
    expect(screen.getByText('1,234,567.89')).toBeInTheDocument();
  });

  it('renders a placeholder when totals are unavailable', () => {
    render(<Scorecard component={component} data={{ columns: [], rows: [], truncated: false, totals: null }} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders a placeholder before the first load', () => {
    render(<Scorecard component={component} data={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run ui/components/Scorecard.test.tsx --poolOptions.threads.maxThreads=4
```
Expected: FAIL.

- [ ] **Step 3: Implement `ui/components/Scorecard.tsx`**

```tsx
import { aggLabel } from '../lib/compile';
import { formatNumber } from '../lib/format';
import type { Component, QueryResult, ScorecardConfig } from '../lib/types';

/**
 * The value comes from `totals`, which the server computes over ALL matching rows (ignoring the
 * row limit). Never sum `rows` here — that would be a client-side calculation and would also be
 * wrong whenever the result is truncated.
 */
export function Scorecard({ component, data }: { component: Component; data: QueryResult | null }) {
  const c = component.config as ScorecardConfig;
  const value = data?.totals?.[aggLabel(c.metric, c.aggregation)];
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="text-2xl font-semibold">{formatNumber(value)}</div>
      <div className="text-xs text-muted-foreground">{c.aggregation} of {c.metric}</div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `ui/components/DataTable.tsx`**

Render `data.columns` / `data.rows` directly — the server already selected, filtered, sorted and limited. Support column show/hide and client-side *display* sorting only if it does not change which rows were fetched; otherwise a sort change must edit `config.sort` and bump `configVersion` so the server re-sorts. Show a "Showing first N rows" note when `data.truncated` is true (there is no pagination).

- [ ] **Step 5: Implement `ui/components/renderComponent.tsx`**

```tsx
import type { ReactNode } from 'react';
import type { Component, QueryResult } from '../lib/types';
import { Scorecard } from './Scorecard';
import { DataTable } from './DataTable';
import { TimeSeriesChart } from './TimeSeriesChart';
import { BarChartView } from './BarChartView';
import { PieChartView } from './PieChartView';

export function renderComponent(component: Component, data: QueryResult | null): ReactNode {
  switch (component.type) {
    case 'scorecard': return <Scorecard component={component} data={data} />;
    case 'table': return <DataTable component={component} data={data} />;
    case 'timeseries': return <TimeSeriesChart component={component} data={data} />;
    case 'bar': return <BarChartView component={component} data={data} />;
    case 'pie':
    case 'donut': return <PieChartView component={component} data={data} />;
  }
}
```

Stub the three chart components to `null` for now; Task 14 fills them in.

- [ ] **Step 6: Run + commit**

```bash
npx vitest run ui/components --poolOptions.threads.maxThreads=4
git add ui/components/Scorecard.tsx ui/components/Scorecard.test.tsx ui/components/DataTable.tsx ui/components/renderComponent.tsx
git commit -m "feat: scorecard (from server totals) and detail table"
```

---

## Task 14: Charts — time series, bar, pie/donut

**Files:**
- Create: `ui/components/ui/chart.tsx` (copy shadcn chart from report-builder)
- Create: `ui/components/TimeSeriesChart.tsx`, `ui/components/BarChartView.tsx`, `ui/components/PieChartView.tsx`
- Create: `ui/lib/rows.ts` — **pure reshaping only, no math**
- Test: `ui/lib/rows.test.ts`, `ui/components/BarChartView.test.tsx`

**Interfaces:**
- Produces:
  - `toPoints(data: QueryResult, labelColumn: string, valueColumn: string): { label: string; value: number }[]`
    — a positional column→object remap. It **must not** aggregate, sum, sort, or bucket: the server already did.
  - `<TimeSeriesChart>`, `<BarChartView>`, `<PieChartView>`, each `({ component, data })`.

- [ ] **Step 1: Write the failing test**

Create `ui/lib/rows.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toPoints } from './rows';
import type { QueryResult } from './types';

const data: QueryResult = {
  columns: ['Source', 'Cost | SUM', 'Row Count'],
  rows: [['google', 30, 3], ['meta', 20, 2]],
  truncated: false, totals: null,
};

describe('toPoints', () => {
  it('maps rows positionally by column name', () => {
    expect(toPoints(data, 'Source', 'Cost | SUM')).toEqual([
      { label: 'google', value: 30 },
      { label: 'meta', value: 20 },
    ]);
  });

  it('preserves server order — it must NOT re-sort', () => {
    const unsorted: QueryResult = { ...data, rows: [['meta', 20, 2], ['google', 30, 3]] };
    expect(toPoints(unsorted, 'Source', 'Cost | SUM').map(p => p.label)).toEqual(['meta', 'google']);
  });

  it('returns [] when a column is missing rather than throwing', () => {
    expect(toPoints(data, 'Nope', 'Cost | SUM')).toEqual([]);
  });

  it('coerces a null metric to 0 for plotting', () => {
    const withNull: QueryResult = { ...data, rows: [['x', null, 1]] };
    expect(toPoints(withNull, 'Source', 'Cost | SUM')).toEqual([{ label: 'x', value: 0 }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run ui/lib/rows.test.ts --poolOptions.threads.maxThreads=4
```
Expected: FAIL.

- [ ] **Step 3: Implement `ui/lib/rows.ts`**

```ts
import type { QueryResult } from './types';

/**
 * Reshape server rows into recharts points. This is a POSITIONAL REMAP ONLY — no summing, no
 * sorting, no bucketing. The server already grouped, aggregated, ordered and limited the result;
 * re-doing any of it here would be a client-side calculation and would disagree with `totals`.
 */
export function toPoints(
  data: QueryResult,
  labelColumn: string,
  valueColumn: string
): { label: string; value: number }[] {
  const li = data.columns.indexOf(labelColumn);
  const vi = data.columns.indexOf(valueColumn);
  if (li === -1 || vi === -1) return [];
  return data.rows.map(r => ({
    label: String(r[li] ?? ''),
    value: Number(r[vi] ?? 0) || 0,
  }));
}
```

- [ ] **Step 4: Copy the shadcn chart component**

```bash
mkdir -p ui/components/ui
cp /Users/flakss/Projects/report-builder/ui/components/ui/chart.tsx ui/components/ui/chart.tsx
cp /Users/flakss/Projects/report-builder/ui/lib/cn.ts ui/lib/cn.ts
```
Fix the import paths inside `chart.tsx` to match this repo's layout.

- [ ] **Step 5: Implement the three chart components**

Each: `toPoints(data, <dimension or bucketed date column>, aggLabel(metric, aggregation))` → recharts.
Colors come from `var(--chart-1)`…`var(--chart-5)`. Clicking a bar or slice calls an optional
`onSegmentFilter({ column, operator: 'eq', value })` (wired in Task 16).

`ui/components/BarChartView.tsx`:
```tsx
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Cell } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from './ui/chart';
import { aggLabel } from '../lib/compile';
import { toPoints } from '../lib/rows';
import type { BarConfig, Component, FilterRule, QueryResult } from '../lib/types';

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

export function BarChartView({
  component, data, onSegmentFilter,
}: {
  component: Component; data: QueryResult | null;
  onSegmentFilter?: (f: FilterRule) => void;
}) {
  const c = component.config as BarConfig;
  if (!data) return null;
  const points = toPoints(data, c.dimension, aggLabel(c.metric, c.aggregation));
  const horizontal = c.orientation === 'horizontal';

  return (
    <ChartContainer config={{ value: { label: c.metric, color: COLORS[0] } }} className="h-full w-full">
      <BarChart data={points} layout={horizontal ? 'vertical' : 'horizontal'}>
        <CartesianGrid strokeDasharray="3 3" />
        {horizontal
          ? (<><XAxis type="number" /><YAxis type="category" dataKey="label" width={90} /></>)
          : (<><XAxis dataKey="label" /><YAxis /></>)}
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar
          dataKey="value"
          onClick={(p: { label?: string }) =>
            p?.label !== undefined && onSegmentFilter?.({ column: c.dimension, operator: 'eq', value: p.label })}
        >
          {points.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
```

`TimeSeriesChart.tsx` is the same shape using `LineChart`/`Line`, with the label column being the
**bucketed date field** — which the server returns under its original name (`c.dateField`).
`PieChartView.tsx` uses `PieChart`/`Pie` with `innerRadius` set when `component.type === 'donut'`.

- [ ] **Step 6: Write a component test**

Create `ui/components/BarChartView.test.tsx` asserting it renders a bar per server row and does not
reorder them (recharts needs an explicit size in jsdom — wrap in a fixed-size div or mock
`ResponsiveContainer`).

- [ ] **Step 7: Run + probe + commit**

```bash
npx vitest run ui/lib/rows.test.ts ui/components --poolOptions.threads.maxThreads=4
npm run css
npx esbuild ui/main.tsx --bundle --format=esm --external:react --external:react-dom \
  --external:react-dom/client --external:react/jsx-runtime --external:react-router-dom \
  --external:@owox/plugin-sdk --outfile=/tmp/probe.js
git add ui/components ui/lib/rows.ts ui/lib/rows.test.ts ui/lib/cn.ts ui/styles.css
git commit -m "feat: recharts time-series, bar and pie/donut renderers"
```

> **Verify the chart theming risk here.** Load the plugin in the real host (`./start.sh --dev`) and
> confirm the `--chart-N` colors resolve inside the iframe. If they do not, bake literal hex values
> into `ui/styles.src.css` and recompile — do not rely on the host's Tailwind theme.

---

## Task 15: Editing — add / remove / duplicate / move / resize / retype

**Files:**
- Create: `ui/components/editors/ComponentEditor.tsx`, `ui/components/editors/AddComponentButton.tsx`
- Create: `ui/lib/edit.ts` — pure doc transforms
- Test: `ui/lib/edit.test.ts`

**Interfaces:**
- Produces (all pure, all returning a NEW Dashboard with `configVersion` bumped):
  - `addComponent(d, type)`, `removeComponent(d, id)`, `duplicateComponent(d, id)`
  - `moveComponent(d, id, delta: -1 | 1)`
  - `resizeComponent(d, id, width, height)`
  - `retypeComponent(d, id, type)`
  - `updateComponent(d, id, patch: Partial<Component>)`
  - `restoreGenerated(d, fields, cardinality)` — re-runs `generate` for the same mart, keeping `id`/`name`.

- [ ] **Step 1: Write the failing test**

Create `ui/lib/edit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { addComponent, removeComponent, duplicateComponent, moveComponent, resizeComponent } from './edit';
import { emptyDashboard } from './types';
import type { Dashboard } from './types';

const base = (): Dashboard => ({
  ...emptyDashboard('d1', 'm1', 'D'),
  components: [
    { id: 'a', type: 'scorecard', title: 'A', width: 1, height: 1, config: { metric: 'x', aggregation: 'SUM' } },
    { id: 'b', type: 'bar', title: 'B', width: 3, height: 2, config: { dimension: 'd', metric: 'x', aggregation: 'SUM', orientation: 'vertical', limit: 10 } },
  ],
});

describe('edit', () => {
  it('every transform bumps configVersion so all components refetch', () => {
    expect(removeComponent(base(), 'a').configVersion).toBe(1);
  });

  it('removeComponent drops only the target', () => {
    expect(removeComponent(base(), 'a').components.map(c => c.id)).toEqual(['b']);
  });

  it('duplicateComponent inserts a copy with a fresh id right after the source', () => {
    const d = duplicateComponent(base(), 'a');
    expect(d.components).toHaveLength(3);
    expect(d.components[1].id).not.toBe('a');
    expect(d.components[1].type).toBe('scorecard');
  });

  it('moveComponent reorders within bounds and is a no-op at the edge', () => {
    expect(moveComponent(base(), 'b', -1).components.map(c => c.id)).toEqual(['b', 'a']);
    expect(moveComponent(base(), 'a', -1).components.map(c => c.id)).toEqual(['a', 'b']);
  });

  it('resizeComponent clamps width to the grid and height to at least 1', () => {
    const d = resizeComponent(base(), 'a', 99, 0);
    expect(d.components[0].width).toBe(5);   // gridColumns
    expect(d.components[0].height).toBe(1);
  });

  it('addComponent appends a component of the requested type', () => {
    const d = addComponent(base(), 'table');
    expect(d.components[d.components.length - 1].type).toBe('table');
  });

  it('does not mutate the input document', () => {
    const d = base();
    removeComponent(d, 'a');
    expect(d.components).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run ui/lib/edit.test.ts --poolOptions.threads.maxThreads=4
```
Expected: FAIL.

- [ ] **Step 3: Implement `ui/lib/edit.ts`**

Every function: clone, transform, `configVersion + 1`, never mutate. `resizeComponent` clamps
`width` to `1..d.gridColumns` and `height` to `>= 1`. `addComponent` picks sane defaults per type
(scorecard `1×1`, bar/pie `3×2` / `2×2`, timeseries/table `5×2` / `5×3`).

- [ ] **Step 4: Implement `ui/components/editors/ComponentEditor.tsx`**

A shadcn sheet, opened from a component's ⋯ menu. Controls: title, description, type, width
(1..gridColumns), height, and the type-specific fields — dimension / metric / aggregation
(restricted to that field's `allowedAggregations`) / granularity (DAY..YEAR only) / sort / limit /
breakdown. Every change calls the matching `edit.ts` transform, so `configVersion` bumps and the
component refetches after the 1 s debounce.

- [ ] **Step 5: Add "Restore generated layout"**

A button in `DashboardView` that re-fetches fields + probes and calls `restoreGenerated`, keeping
the dashboard's `id`, `name` and `$entity`.

- [ ] **Step 6: Run + commit**

```bash
npx vitest run ui/lib/edit.test.ts --poolOptions.threads.maxThreads=4
npm run typecheck
git add ui/lib/edit.ts ui/lib/edit.test.ts ui/components/editors
git commit -m "feat: component editing — add/remove/duplicate/move/resize/retype + restore"
```

---

## Task 16: Cross-filtering and filter reset

**Files:**
- Modify: `ui/components/DashboardView.tsx`, `ui/components/renderComponent.tsx`, `ui/components/FilterBar.tsx`
- Test: `ui/lib/edit.test.ts` (extend)

**Interfaces:**
- Produces: `addGlobalFilter(d: Dashboard, f: FilterRule): Dashboard` and
  `resetFilters(d: Dashboard): Dashboard` in `ui/lib/edit.ts`.

- [ ] **Step 1: Write the failing test**

Add to `ui/lib/edit.test.ts`:

```ts
import { addGlobalFilter, resetFilters } from './edit';

it('addGlobalFilter appends a filter and bumps configVersion so every component refetches', () => {
  const d = addGlobalFilter(base(), { column: 'country', operator: 'eq', value: 'US' });
  expect(d.filters).toEqual([{ column: 'country', operator: 'eq', value: 'US' }]);
  expect(d.configVersion).toBe(1);
});

it('addGlobalFilter replaces an existing filter on the same column rather than stacking', () => {
  let d = addGlobalFilter(base(), { column: 'country', operator: 'eq', value: 'US' });
  d = addGlobalFilter(d, { column: 'country', operator: 'eq', value: 'DE' });
  expect(d.filters).toHaveLength(1);
  expect(d.filters[0].value).toBe('DE');
});

it('resetFilters clears filters but keeps the generated date slices', () => {
  const withSlice = { ...base(), slices: [{ column: 'Date', operator: 'relative_date', value: { kind: 'last_n_days', n: 30 } }] };
  const d = resetFilters(addGlobalFilter(withSlice, { column: 'x', operator: 'eq', value: 1 }));
  expect(d.filters).toEqual([]);
  expect(d.slices).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

```ts
/** Cross-filter: clicking a bar/slice sets a GLOBAL filter — filters are never per-component. */
export function addGlobalFilter(d: Dashboard, f: FilterRule): Dashboard {
  return {
    ...d,
    filters: [...d.filters.filter(x => x.column !== f.column), f],
    configVersion: d.configVersion + 1,
  };
}

export function resetFilters(d: Dashboard): Dashboard {
  return { ...d, filters: [], configVersion: d.configVersion + 1 };
}
```

- [ ] **Step 3: Wire it through**

Thread `onSegmentFilter` from `DashboardView` → `renderComponent` → the chart components, calling
`addGlobalFilter`. Add a "Reset filters" button to `FilterBar` calling `resetFilters`. Because every
component's query is keyed on `configVersion`, one click refetches the whole dashboard — with each
component showing its preload state.

- [ ] **Step 4: Run + commit**

```bash
npx vitest run ui/lib --poolOptions.threads.maxThreads=4
git add ui/lib/edit.ts ui/lib/edit.test.ts ui/components
git commit -m "feat: cross-filtering from chart segments + filter reset"
```

---

## Task 17: End-to-end verification against the real host

No new code — this is the gate before publishing.

- [ ] **Step 1: Full test suite + typecheck + host build probe**

```bash
cd /Users/flakss/Projects/data-mart-dashboardization
npx vitest run --poolOptions.threads.maxThreads=4
npm run typecheck
npm run css
npm install --ignore-scripts --omit=dev && npx esbuild ui/main.tsx --bundle --format=esm \
  --external:react --external:react-dom --external:react-dom/client \
  --external:react/jsx-runtime --external:react/jsx-dev-runtime \
  --external:react-router-dom --external:@owox/plugin-sdk --outfile=/tmp/probe.js
```
Expected: all pass.

- [ ] **Step 2: Run against the real capability broker**

```bash
cp owox.dev.example.json owox.dev.json    # fill apiUrl + apiKey; NEVER commit this file
npm run dev:broker                         # iframe :5177, broker :5178
```
Point `apiUrl` at a backend that has the Task 1 endpoint. Create a dashboard from a real mart and
confirm: charts render, filters refetch, scorecards match the mart's real totals.

Watch every brokered call at `http://localhost:5177/host/plugin-dev-log`.

- [ ] **Step 3: Install into the real host (the only place the postMessage transport runs)**

```bash
cd /Users/flakss/Projects/owox-data-marts-experimental && ./start.sh --dev
```
Push this repo to GitHub, then in the host: **Plugins → New Plugin → GitHub URL** → grant the
`data-mart` view permission → open **Dashboards**.

Confirm:
- [ ] The dashboard list shows only dashboards whose data mart the user can access (`$entity` ACL).
- [ ] `--chart-N` colors resolve inside the iframe (the theming risk from Task 14).
- [ ] The `.dm-*` chrome matches the Storages/Destinations pages — a titled header and one card.
- [ ] Editing a component refetches after ~1 s and shows the preload overlay.
- [ ] Author appears on the list (from the host's `$createdBy` stamp).

- [ ] **Step 4: Commit any fixes and tag**

```bash
git add -A && git commit -m "fix: host integration issues found in end-to-end verification"
```

---

## Self-Review Notes

- **Spec coverage:** date filters (T12), scorecards (T13), time-series/bar/pie/donut (T14), table
  (T13), auto-generation (T9), editing (T15), cross-filtering + reset (T16), CRUD (T11),
  KV/collections persistence (T7), mart-derived access (T7, via `$entity`), width **and** height
  (T4/T12/T15), global-only filters (T4/T16), preload on update (T8/T12), server-side aggregation
  (T1/T6).
- **Deliberately not built (spec §14):** multi-select (`in`) filters, `HOUR` granularity, and table
  pagination — all rejected by the query service; drill-down; `backend.ts`/assistant tools;
  AI-assisted generation.
- **Riskiest tasks:** Task 1 (a pull that moves 53 commits) and Task 14 (chart theming under the
  host's default-Tailwind build). Both have an explicit verification step.
