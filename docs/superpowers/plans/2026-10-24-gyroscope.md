# Gyroscope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboards plugin in this repo with Gyroscope, a UI-only OWOX Data Marts plugin that draws a CEO canvas of business classes with key metrics against plan.

**Architecture:** A Vite + React page talks to OWOX only through `connect()` from `@owox/plugin-sdk`. Pure modules (`src/lib`, `src/model`, `src/metrics`) hold all logic and take plain inputs, so they are tested without a host. The AI (`ctx.credentials.ai`) runs once per model build to read descriptions; every refresh replays the saved model and writes a cache document that the canvas renders from.

**Tech Stack:** TypeScript 5.9, React 19, Vite 8, `@owox/plugin-sdk` 0.39.0, `ai` 7, `zod` 4, `lucide-react`, Vitest 4 + happy-dom + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-24-gyroscope-design.md`. API facts the code relies on are in `tmp/api-notes.md` (gitignored, local only). Read both before starting a task.

## Global Constraints

1. `@owox/plugin-sdk` is pinned to exactly `0.39.0`. `ai` is `^7.0.153`. `zod` is `^4.1.8`. Node is 22.22 or newer.
2. Never install `@owox/api-client` directly. All OWOX calls go through `ctx.owox`.
3. The plugin runs in an opaque-origin iframe: no `localStorage`, `sessionStorage`, `IndexedDB`, cookies or `<form>` submit. Persist only through `ctx.collections`.
4. Collections are exactly `model`, `cache`, `settings`, all `"scope": "project"`.
5. Vite `base` is `/gyroscope/`. `plugin.json` `delivery.url` is `https://owox.github.io/gyroscope/`.
6. All dates are UTC strings `YYYY-MM-DD` (type `Day`). Never use local-time `Date` getters.
7. At most 6 OWOX requests in flight from Gyroscope at once (`runPool(tasks, 6)`).
8. Tests run with `npx vitest run --maxWorkers=4`. Never run Vitest unbounded.
9. Copy: the UI never prints the words "Unique Count". A Unique Count metric is labelled with the class title only.
10. Colours: blue `#459ce9` default border, green `#27ae60` above plan, orange `#f2994a` near plan, red `#eb5757` below plan, grey `#828ea5` error or neutral badge.
11. Number font is Space Mono with `font-variant-numeric: tabular-nums`; text font is Roboto 300/400/500.
12. Code comments follow the repo style: sparse, and only where the reason is not obvious.

## Review Focus

1. A class whose primary key has two or more columns (OWOX's `Fact. Product ARR. Daily` has `date + customerId + productId`). It must get no Unique Count metric and never send `COUNT_DISTINCT` on a composite key. Test in Task 7.
2. A range that starts after the anchor, for example "This week" opened on a Monday. The fact window is empty, so the card shows "—" for fact, a forecast, and no % diff. Tests in Task 2 and Task 8.
3. NDJSON values that arrive as strings (`"1234.50"`), `null` or missing keys. They are coerced, and `NaN` is never stored or rendered. Test in Task 8.
4. Formula refs written with single quotes or extra spaces, refs without `path`, and refs whose path passes through a mart the member cannot see. The first parse, the second makes no edge, the third makes no edge. Tests in Task 3 and Task 6.
5. Project description `null` or empty, or context descriptions `null`. The build ends in the `NO_GOAL` blocked state, not a crash. Test in Task 7.

---

## File structure

```
plugin.json                      public manifest
index.html                       Vite entry
vite.config.ts                   base /gyroscope/, Vitest config
tsconfig.json
package.json
.github/workflows/deploy-pages.yml
src/
  main.tsx                       connect(), theme, render <App/>
  App.tsx                        state machine: loading, intro, building, blocked, ready, settings
  styles.css                     tokens and component styles
  types.ts                       every shared type and default
  test-setup.ts                  jest-dom matchers
  lib/
    dates.ts                     presets, windows, day arithmetic
    refs.ts                      {{ref}} parsing
    links.ts                     Data Mart links in Markdown
    stats.ts                     fit, forecast, plan reduce, status, trend, diff
    format.ts                    compact numbers, % diff, labels
    pool.ts                      bounded concurrency
    hash.ts                      FNV-1a string hash
    errors.ts                    describeError
  owox/
    sources.ts                   typed fetchers over ctx.owox
  model/
    graph.ts                     edges, main class, classes and depths
    interpret.ts                 AI prompt and output schema
    validate.ts                  AI output to MetricDefs or blockers
    build.ts                     orchestrates a model build
  metrics/
    query.ts                     traverseData option builders and row readers
    compute.ts                   one metric's result for one range
    refresh.ts                   whole-canvas refresh into a CacheDoc
  store/
    collections.ts               model, cache and settings documents
  ui/
    Sparkline.tsx
    Badge.tsx
    Card.tsx
    Canvas.tsx                   rows, context chips, connectors
    layout.ts                    rows and connectors for a filter
    Header.tsx                   range picker, comparison, buttons
    Blocked.tsx                  blocked screens with fix steps
    SettingsPage.tsx
```

Everything under `ui/` (old), `src/test-setup.ts` (old), `tailwind.config.ts`, `postcss.config.js`, `vitest.config.ts`, `scripts/`, `owox.dev.example.json` is deleted in Task 1.

---

### Task 1: Scaffold the plugin and shared types

**Files:**
- Delete: `ui/`, `src/test-setup.ts`, `tailwind.config.ts`, `postcss.config.js`, `vitest.config.ts`, `scripts/`, `owox.dev.example.json`
- Rewrite: `plugin.json`, `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`
- Create: `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`, `src/types.ts`, `src/test-setup.ts`, `src/App.test.tsx`, `.github/workflows/deploy-pages.yml`

**Interfaces:**
- Produces: every type in `src/types.ts` below, exactly as written. Later tasks import from `../types`.

- [ ] **Step 1: Delete the old plugin**

```bash
git rm -r -q ui src/test-setup.ts tailwind.config.ts postcss.config.js vitest.config.ts scripts owox.dev.example.json
rm -rf node_modules package-lock.json
```

- [ ] **Step 2: Write `plugin.json`**

```json
{
  "name": "Gyroscope",
  "description": "Shows the CEO whether the company is on track for its goal, class by class, against plan.",
  "delivery": { "type": "remote", "url": "https://owox.github.io/gyroscope/" },
  "credentials": ["ai"],
  "collections": [
    { "name": "model", "scope": "project" },
    { "name": "cache", "scope": "project" },
    { "name": "settings", "scope": "project" }
  ]
}
```

- [ ] **Step 3: Write `package.json`**

```json
{
  "name": "gyroscope",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.22.0" },
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run --maxWorkers=4",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@owox/plugin-sdk": "0.39.0",
    "ai": "^7.0.153",
    "lucide-react": "^1.61.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^4.1.8"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "happy-dom": "^21.0.4",
    "typescript": "~5.9.0",
    "vite": "8.3.5",
    "vitest": "^4.1.9"
  }
}
```

Run: `npm install`
Expected: installs without peer-dependency errors. If `ai` and the SDK disagree on `@ai-sdk/provider`, keep both; Task 7 casts at one call site.

- [ ] **Step 4: Write `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/gyroscope/',
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['src/test-setup.ts'],
  },
});
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Gyroscope</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`.gitignore`:

```
node_modules/
dist/
*.tsbuildinfo
tmp/
.superpowers/
```

- [ ] **Step 5: Write `src/types.ts`**

```ts
export type Day = string; // 'YYYY-MM-DD', UTC

export type Preset =
  | 'last_year' | 'last_quarter' | 'last_month' | 'last_week'
  | 'last_28d' | 'last_7d' | 'yesterday'
  | 'ytd'
  | 'this_year' | 'this_quarter' | 'this_month' | 'this_week';

export interface DateWindow { from: Day; to: Day } // both inclusive

export interface RangeSpec {
  preset: Preset;
  anchor: Day;               // yesterday
  range: DateWindow;
  days: number;              // length of range in days
  factWindow: DateWindow | null;       // range clipped to the anchor; null when the range starts after it
  comparison: DateWindow | null;       // factWindow shifted back by `days`; null when factWindow is null
  endsInFuture: boolean;     // range.to > anchor
}

export type AggFn = 'SUM' | 'COUNT' | 'COUNT_DISTINCT' | 'AVG' | 'MIN' | 'MAX';
export type MetricKind = 'flow' | 'level';
export type PlanShape = 'daily' | 'cumulative' | 'level';
export type MetricRole = 'critical' | 'leading' | 'lagging' | 'unique';

/** fn null means a calculated field of level 'metric', selected by name without aggregation. */
export interface Measure { field: string; fn: AggFn | null }

export interface PlanDef { martId: string; measure: Measure; dateField: string; shape: PlanShape }

export interface MetricDef {
  id: string;                // `${martId}:${measure.field}:${fn ?? 'calc'}`
  martId: string;
  alias: string;             // "ARR"; for unique count the class title
  measure: Measure;
  kind: MetricKind;
  dateField: string | null;  // null: no date filter, all time, no series
  role: MetricRole;
  source: 'project' | string; // 'project' or a context id; 'schema' for unique count
  isUniqueCount: boolean;
  plan: PlanDef | null;
}

export interface ContextRef { id: string; name: string }

export interface ClassNode {
  id: string;                // equals martId
  martId: string;
  title: string;
  contexts: ContextRef[];
  depth: number;             // 0 = main class
  keyMetricId: string | null;
  metricIds: string[];       // key first, then badges in role order
}

export interface Edge { from: string; to: string }

export interface Model {
  version: 1;
  inputHash: string;
  builtAt: string;           // ISO timestamp
  builtBy: string;           // ctx.userId
  goal: { classId: string; metricId: string | null; goalMartId: string; viaFallback: boolean };
  classes: ClassNode[];
  edges: Edge[];
  metrics: MetricDef[];
}

export type BlockCode =
  | 'NO_GOAL' | 'GOAL_PLACEHOLDER' | 'GOAL_FIELD_NOT_FOUND' | 'GOAL_NO_PRIMARY_KEY'
  | 'GOAL_NOT_CONNECTED' | 'AI_NOT_CONFIGURED' | 'AI_INVALID';

export interface Blocked { code: BlockCode; detail: string; mismatches: string[] }

export type BuildResult = { ok: true; model: Model } | { ok: false; blocked: Blocked };

export type Status = 'neutral' | 'above' | 'near' | 'below';
export type Trend = 'up' | 'down' | 'flat';

/** Compact daily series: values[i] is the value on start + i days. */
export interface SeriesPack {
  start: Day;
  values: (number | null)[];
  forecastStart: Day | null;
  forecast: number[];
}

export interface MetricResult {
  fact: number | null;
  comparison: number | null;
  diffPct: number | null;
  plan: number | null;
  forecast: number | null;
  forecastApprox: boolean;
  status: Status;
  trend: Trend;
  note: 'short_history' | 'no_date_field' | null;
  error: string | null;
}

export interface CardCache { metrics: Record<string, MetricResult>; spark: SeriesPack | null }

export interface CacheDoc {
  modelHash: string;
  anchor: Day;
  refreshedAt: string;
  preset: Preset;
  comparison: boolean;
  cards: Record<string, CardCache>;
}

export interface Settings { thresholdPct: number; defaultPreset: Preset; comparisonDefault: boolean }

export const DEFAULT_SETTINGS: Settings = { thresholdPct: 20, defaultPreset: 'this_quarter', comparisonDefault: true };

export const PRESET_LABELS: Record<Preset, string> = {
  last_year: 'Last year', last_quarter: 'Last quarter', last_month: 'Last month', last_week: 'Last week',
  last_28d: 'Last 28 days', last_7d: 'Last 7 days', yesterday: 'Yesterday',
  ytd: 'Year to date',
  this_year: 'This year', this_quarter: 'This quarter', this_month: 'This month', this_week: 'This week',
};

export const PRESET_GROUPS: { label: string; presets: Preset[] }[] = [
  { label: 'Past', presets: ['last_year', 'last_quarter', 'last_month', 'last_week', 'last_28d', 'last_7d', 'yesterday'] },
  { label: 'To date', presets: ['ytd'] },
  { label: 'Current', presets: ['this_year', 'this_quarter', 'this_month', 'this_week'] },
];
```

- [ ] **Step 6: Write `src/styles.css` with the tokens**

```css
:root {
  color-scheme: dark;
  --page: #1a1f2e; --card: #242a3b; --nested: #2b3346;
  --text: #e9ecf2; --text-2: #9ba4b6; --muted: #828ea5;
  --border: #3a4358; --border-quiet: #2e374b; --border-hover: #6f778d;
  --blue: #459ce9; --green: #27ae60; --orange: #f2994a; --red: #eb5757; --grey: #828ea5;
  --font-text: Roboto, ui-sans-serif, system-ui, sans-serif;
  --font-num: 'Space Mono', ui-monospace, monospace;
}
:root.light {
  color-scheme: light;
  --page: #f5f7fb; --card: #ffffff; --nested: #edf1f8;
  --text: #1a1f2e; --text-2: #42506b; --muted: #5e6b85;
  --border: #d1d9e6; --border-quiet: #e2e8f1; --border-hover: #b4bfd1;
  --blue: #0b63b8; --green: #14713c; --orange: #9e4c04; --red: #c60e0e; --grey: #5e6b85;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--text); font: 400 16px/1.5 var(--font-text); }
button { font: inherit; color: inherit; }
.num { font-family: var(--font-num); font-variant-numeric: tabular-nums; }
.label { font: 400 11px/1.4 var(--font-num); text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.gy-page { min-height: 100vh; }
.gy-main { padding: 24px 56px 56px; }
@media (max-width: 700px) { .gy-main { padding: 16px; } }
.gy-btn { height: 36px; padding: 0 16px; border: 1px solid var(--border); background: var(--card); cursor: pointer; }
.gy-btn:hover { border-color: var(--border-hover); }
.gy-btn:focus-visible, .gy-chip:focus-visible, select:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.gy-btn-primary { background: var(--blue); border-color: var(--blue); color: #fff; }
.gy-muted { color: var(--text-2); }
```

Later UI tasks append their own rules to this file.

- [ ] **Step 7: Write `src/main.tsx`, a placeholder `src/App.tsx`, `src/test-setup.ts`**

`src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import { connect } from '@owox/plugin-sdk';
import { App } from './App';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

connect().then(
  (ctx) => {
    document.documentElement.classList.toggle('light', ctx.theme === 'light');
    root.render(<App ctx={ctx} />);
  },
  () => {
    root.render(<p style={{ padding: 24 }}>Open Gyroscope from Plugins in OWOX Data Marts.</p>);
  },
);
```

`src/App.tsx` (Task 12 replaces the body):

```tsx
import type { PluginContext } from '@owox/plugin-sdk';

export function App(_props: { ctx: PluginContext }) {
  return (
    <div className="gy-page">
      <main className="gy-main"><h1>Gyroscope</h1></main>
    </div>
  );
}
```

`src/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 8: Write the smoke test `src/App.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { App } from './App';

test('renders the title', () => {
  render(<App ctx={{} as never} />);
  expect(screen.getByRole('heading', { name: 'Gyroscope' })).toBeInTheDocument();
});
```

Run: `npx vitest run --maxWorkers=4`
Expected: 1 passed.

- [ ] **Step 9: Write `.github/workflows/deploy-pages.yml`**

```yaml
name: Deploy plugin to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 10: Verify and commit**

Run: `npm run typecheck && npx vitest run --maxWorkers=4 && npx vite build`
Expected: all pass; `dist/index.html` exists.

```bash
git add -A
git commit -m "feat: scaffold Gyroscope plugin on the public plugin SDK"
```

---

### Task 2: Date ranges (`src/lib/dates.ts`)

**Files:**
- Create: `src/lib/dates.ts`, `src/lib/dates.test.ts`

**Interfaces:**
- Consumes: `Day`, `DateWindow`, `Preset`, `RangeSpec` from `../types`.
- Produces:
  - `toDay(ms: number): Day`, `parseDay(d: Day): number`, `addDays(d: Day, n: number): Day`, `diffDays(a: Day, b: Day): number` (b minus a), `minDay(a, b)`, `maxDay(a, b)`, `eachDay(w: DateWindow): Day[]`
  - `anchorFor(now: Date): Day`
  - `rangeFor(preset: Preset, now: Date): RangeSpec`

Rules. Today is `anchor + 1`. "Last X" is the full calendar period before the period that contains today. "This X" is the full period containing today. YTD is Jan 1 of the anchor's year to the anchor. Weeks start on Monday.

- [ ] **Step 1: Write the failing tests**

```ts
import { addDays, anchorFor, diffDays, eachDay, rangeFor } from './dates';

const at = (iso: string) => new Date(iso);

test('day arithmetic is UTC', () => {
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  expect(diffDays('2026-10-01', '2026-10-23')).toBe(22);
  expect(eachDay({ from: '2026-10-30', to: '2026-11-01' })).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  expect(anchorFor(at('2026-10-24T00:30:00Z'))).toBe('2026-10-23');
});

test.each([
  ['yesterday', '2026-10-23', '2026-10-23'],
  ['last_7d', '2026-10-17', '2026-10-23'],
  ['last_28d', '2026-09-26', '2026-10-23'],
  ['last_week', '2026-10-12', '2026-10-18'],
  ['last_month', '2026-09-01', '2026-09-30'],
  ['last_quarter', '2026-07-01', '2026-09-30'],
  ['last_year', '2025-01-01', '2025-12-31'],
  ['ytd', '2026-01-01', '2026-10-23'],
  ['this_week', '2026-10-19', '2026-10-25'],
  ['this_month', '2026-10-01', '2026-10-31'],
  ['this_quarter', '2026-10-01', '2026-12-31'],
  ['this_year', '2026-01-01', '2026-12-31'],
] as const)('%s on Sat 2026-10-24', (preset, from, to) => {
  const r = rangeFor(preset, at('2026-10-24T10:00:00Z'));
  expect(r.anchor).toBe('2026-10-23');
  expect(r.range).toEqual({ from, to });
});

test('this quarter: fact clipped to anchor, comparison shifted by range length', () => {
  const r = rangeFor('this_quarter', at('2026-10-24T10:00:00Z'));
  expect(r.days).toBe(92);
  expect(r.factWindow).toEqual({ from: '2026-10-01', to: '2026-10-23' });
  expect(r.comparison).toEqual({ from: '2026-07-01', to: '2026-07-23' });
  expect(r.endsInFuture).toBe(true);
});

test('past range: comparison is the previous same-length window', () => {
  const r = rangeFor('last_7d', at('2026-10-24T10:00:00Z'));
  expect(r.comparison).toEqual({ from: '2026-10-10', to: '2026-10-16' });
  expect(r.endsInFuture).toBe(false);
});

test('this week on a Monday starts after the anchor', () => {
  const r = rangeFor('this_week', at('2026-10-26T08:00:00Z'));
  expect(r.range).toEqual({ from: '2026-10-26', to: '2026-11-01' });
  expect(r.factWindow).toBeNull();
  expect(r.comparison).toBeNull();
});

test('ytd on Jan 1 covers the previous year', () => {
  expect(rangeFor('ytd', at('2027-01-01T08:00:00Z')).range).toEqual({ from: '2026-01-01', to: '2026-12-31' });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --maxWorkers=4 src/lib/dates.test.ts`
Expected: FAIL, module `./dates` not found.

- [ ] **Step 3: Implement `src/lib/dates.ts`**

```ts
import type { DateWindow, Day, Preset, RangeSpec } from '../types';

const DAY_MS = 86_400_000;

export const toDay = (ms: number): Day => new Date(ms).toISOString().slice(0, 10);
export const parseDay = (d: Day): number => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: Day, n: number): Day => toDay(parseDay(d) + n * DAY_MS);
export const diffDays = (a: Day, b: Day): number => Math.round((parseDay(b) - parseDay(a)) / DAY_MS);
export const minDay = (a: Day, b: Day): Day => (a < b ? a : b);
export const maxDay = (a: Day, b: Day): Day => (a > b ? a : b);

export function eachDay(w: DateWindow): Day[] {
  const out: Day[] = [];
  for (let d = w.from; d <= w.to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const anchorFor = (now: Date): Day => addDays(toDay(now.getTime()), -1);

const ymd = (y: number, m: number, d: number): Day => toDay(Date.UTC(y, m - 1, d));
const parts = (d: Day) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) });

type Unit = 'week' | 'month' | 'quarter' | 'year';

function periodOf(d: Day, unit: Unit): DateWindow {
  const { y, m } = parts(d);
  if (unit === 'week') {
    const dow = (new Date(parseDay(d)).getUTCDay() + 6) % 7;
    const from = addDays(d, -dow);
    return { from, to: addDays(from, 6) };
  }
  if (unit === 'month') return { from: ymd(y, m, 1), to: addDays(ymd(y, m + 1, 1), -1) };
  if (unit === 'quarter') {
    const qm = Math.floor((m - 1) / 3) * 3 + 1;
    return { from: ymd(y, qm, 1), to: addDays(ymd(y, qm + 3, 1), -1) };
  }
  return { from: ymd(y, 1, 1), to: ymd(y, 12, 31) };
}

const previous = (d: Day, unit: Unit): DateWindow => periodOf(addDays(periodOf(d, unit).from, -1), unit);

function windowFor(preset: Preset, anchor: Day): DateWindow {
  const today = addDays(anchor, 1);
  switch (preset) {
    case 'yesterday': return { from: anchor, to: anchor };
    case 'last_7d': return { from: addDays(anchor, -6), to: anchor };
    case 'last_28d': return { from: addDays(anchor, -27), to: anchor };
    case 'last_week': return previous(today, 'week');
    case 'last_month': return previous(today, 'month');
    case 'last_quarter': return previous(today, 'quarter');
    case 'last_year': return previous(today, 'year');
    case 'ytd': return { from: periodOf(anchor, 'year').from, to: anchor };
    case 'this_week': return periodOf(today, 'week');
    case 'this_month': return periodOf(today, 'month');
    case 'this_quarter': return periodOf(today, 'quarter');
    case 'this_year': return periodOf(today, 'year');
  }
}

export function rangeFor(preset: Preset, now: Date): RangeSpec {
  const anchor = anchorFor(now);
  const range = windowFor(preset, anchor);
  const days = diffDays(range.from, range.to) + 1;
  const factWindow = range.from > anchor ? null : { from: range.from, to: minDay(range.to, anchor) };
  const comparison = factWindow
    ? { from: addDays(factWindow.from, -days), to: addDays(factWindow.to, -days) }
    : null;
  return { preset, anchor, range, days, factWindow, comparison, endsInFuture: range.to > anchor };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --maxWorkers=4 src/lib/dates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dates.ts src/lib/dates.test.ts
git commit -m "feat(dates): UTC presets, fact window and comparison window"
```

---

### Task 3: Formula refs and Markdown links (`src/lib/refs.ts`, `src/lib/links.ts`)

**Files:**
- Create: `src/lib/refs.ts`, `src/lib/refs.test.ts`, `src/lib/links.ts`, `src/lib/links.test.ts`

**Interfaces:**
- Produces:
  - `interface FormulaRef { path: string; field: string }` (path `''` means the mart itself)
  - `parseRefs(formula: string): FormulaRef[]`
  - `interface MartLink { index: number; source: 'project' | string; text: string; url: string; martId: string | null; field: string | null; placeholder: boolean }`
  - `extractLinks(markdown: string | null | undefined, source: 'project' | string, startIndex: number): MartLink[]`

A link is a Data Mart link when its URL contains `/data-marts/`. `martId` is the UUID after `/data-marts/`. `field` is the `field` query parameter decoded with `URLSearchParams` (so `+` becomes a space). A Data Mart link without a UUID (for example `<FACT_ARR_ID>`) has `placeholder: true` and `martId: null`. Links whose URL does not contain `/data-marts/` are skipped.

- [ ] **Step 1: Write the failing tests**

`src/lib/refs.test.ts`:

```ts
import { parseRefs } from './refs';

test('own and joined refs, any quoting and spacing', () => {
  const f = `SUM({{ref field="revenue"}}) / COUNT({{ ref  path='orders.items'   field='qty' }}) + {{ref field="x" path="customers"}}`;
  expect(parseRefs(f)).toEqual([
    { path: '', field: 'revenue' },
    { path: 'orders.items', field: 'qty' },
    { path: 'customers', field: 'x' },
  ]);
});

test('ignores non-ref mustaches and refs without field', () => {
  expect(parseRefs('{{other field="a"}} {{ref path="a"}}')).toEqual([]);
});
```

`src/lib/links.test.ts`:

```ts
import { extractLinks } from './links';

const MD = `| Critical number | ARR | [Plan · ARR](https://app.owox.com/ui/p1/data-marts/<PLAN_ID>/data-setup?field=arr) | [ARR](https://app.owox.com/ui/p1/data-marts/86d5294a-a33d-4c06-9944-8680e7c96d72/data-setup?field=arr) |
See [docs](https://docs.owox.com) and [Visitors](https://app.owox.com/ui/p1/data-marts/3be86edb-b880-498b-b533-459640b99106/data-setup?x=1&field=last+Visit%2EDate).`;

test('extracts data mart links, flags placeholders, skips others', () => {
  expect(extractLinks(MD, 'project', 0)).toEqual([
    { index: 0, source: 'project', text: 'Plan · ARR', url: 'https://app.owox.com/ui/p1/data-marts/<PLAN_ID>/data-setup?field=arr', martId: null, field: 'arr', placeholder: true },
    { index: 1, source: 'project', text: 'ARR', url: 'https://app.owox.com/ui/p1/data-marts/86d5294a-a33d-4c06-9944-8680e7c96d72/data-setup?field=arr', martId: '86d5294a-a33d-4c06-9944-8680e7c96d72', field: 'arr', placeholder: false },
    { index: 2, source: 'project', text: 'Visitors', url: 'https://app.owox.com/ui/p1/data-marts/3be86edb-b880-498b-b533-459640b99106/data-setup?x=1&field=last+Visit%2EDate', martId: '3be86edb-b880-498b-b533-459640b99106', field: 'last Visit.Date', placeholder: false },
  ]);
});

test('null and empty markdown give no links', () => {
  expect(extractLinks(null, 'project', 0)).toEqual([]);
  expect(extractLinks('', 'c1', 5)).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --maxWorkers=4 src/lib/refs.test.ts src/lib/links.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/lib/refs.ts`:

```ts
export interface FormulaRef { path: string; field: string }

const TAG = /\{\{\s*ref\s+([^}]*)\}\}/g;
const ATTR = /(path|field)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseRefs(formula: string): FormulaRef[] {
  const out: FormulaRef[] = [];
  for (const tag of formula.matchAll(TAG)) {
    const attrs: Record<string, string> = {};
    for (const a of (tag[1] ?? '').matchAll(ATTR)) attrs[a[1]!] = a[2] ?? a[3] ?? '';
    if (attrs.field) out.push({ path: attrs.path ?? '', field: attrs.field });
  }
  return out;
}
```

`src/lib/links.ts`:

```ts
export interface MartLink {
  index: number;
  source: 'project' | string;
  text: string;
  url: string;
  martId: string | null;
  field: string | null;
  placeholder: boolean;
}

const LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;
const MART = /\/data-marts\/([^/?#]+)/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function extractLinks(markdown: string | null | undefined, source: 'project' | string, startIndex: number): MartLink[] {
  if (!markdown) return [];
  const out: MartLink[] = [];
  for (const m of markdown.matchAll(LINK)) {
    const url = m[2]!;
    const seg = MART.exec(url)?.[1];
    if (seg === undefined) continue;
    const query = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0]! : '';
    const field = new URLSearchParams(query).get('field');
    const martId = UUID.test(seg) ? seg.toLowerCase() : null;
    out.push({ index: startIndex + out.length, source, text: m[1]!.trim(), url, martId, field, placeholder: martId === null });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --maxWorkers=4 src/lib/refs.test.ts src/lib/links.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/refs.ts src/lib/refs.test.ts src/lib/links.ts src/lib/links.test.ts
git commit -m "feat(lib): parse formula refs and Data Mart links"
```

---

### Task 4: Statistics and formatting (`src/lib/stats.ts`, `src/lib/format.ts`)

**Files:**
- Create: `src/lib/stats.ts`, `src/lib/stats.test.ts`, `src/lib/format.ts`, `src/lib/format.test.ts`

**Interfaces:**
- Consumes: `Day`, `DateWindow`, `MetricKind`, `PlanShape`, `Status`, `Trend` from `../types`; `addDays`, `diffDays`, `eachDay` from `./dates`.
- Produces from `stats.ts`:
  - `type DailyMap = Map<Day, number>`
  - `linearFit(points: { x: number; y: number }[]): { slope: number; intercept: number } | null` (null when fewer than 2 points)
  - `forecastFor(args: { daily: DailyMap; anchor: Day; rangeTo: Day; kind: MetricKind; fact: number | null }): { value: number; future: { d: Day; v: number }[] } | null`
  - `planForRange(plan: DailyMap, range: DateWindow, shape: PlanShape): number | null`
  - `levelAt(daily: DailyMap, w: DateWindow): number | null` (value on the last day of `w` that has data)
  - `statusOf(value: number | null, plan: number | null, thresholdPct: number): Status`
  - `trendOf(daily: DailyMap, w: DateWindow): Trend`
  - `diffPct(fact: number | null, comparison: number | null): number | null`
- Produces from `format.ts`:
  - `compact(n: number | null): string` (`'—'` for null)
  - `formatPct(p: number | null): string` (`'+8.3%'`, `'−4.0%'` with U+2212, `''` for null)
  - `metricLabel(alias: string, classTitle: string, isUniqueCount: boolean): string`

Forecast rule (spec 7.2). History is the days from `anchor − 89` to `anchor` that have a value. Fewer than 14 such days returns null. x is days since `anchor − 89`. Fitted values are clamped at 0. Flow: `fact + Σ fitted(d)` for `d` from `anchor + 1` to `rangeTo`. Level: `fitted(rangeTo)`. `future` lists the fitted value of each day after the anchor.

Plan rule (spec 7.3). `daily`: sum of plan days in the range, null when none. `level`: `levelAt(plan, range)`. `cumulative`: `end = levelAt(plan, range)`; `base = plan.get(range.from − 1)`; when `base` is missing or `base > plan.get(range.from)` (the plan restarted at the range start), the result is `end`, else `end − base`.

Trend: least-squares slope over the days in `w` that have values. Positive is up, negative is down, zero or fewer than 2 points is flat.

Status: `plan` null or 0 gives neutral. `gap = (value − plan) / |plan|`. `gap > 0` above, `gap ≥ −threshold/100` near, else below. `value` null gives neutral.

- [ ] **Step 1: Write the failing tests**

`src/lib/stats.test.ts`:

```ts
import { diffPct, forecastFor, levelAt, linearFit, planForRange, statusOf, trendOf } from './stats';
import { addDays } from './dates';

const series = (from: string, values: number[]) => new Map(values.map((v, i) => [addDays(from, i), v]));

test('linear fit', () => {
  expect(linearFit([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }])).toEqual({ slope: 2, intercept: 1 });
  expect(linearFit([{ x: 0, y: 1 }])).toBeNull();
});

test('flow forecast adds fitted remaining days to fact', () => {
  const daily = series('2026-07-26', Array.from({ length: 90 }, () => 10)); // flat 10/day to 2026-10-23
  const f = forecastFor({ daily, anchor: '2026-10-23', rangeTo: '2026-10-31', kind: 'flow', fact: 230 });
  expect(f!.value).toBeCloseTo(230 + 8 * 10);
  expect(f!.future).toHaveLength(8);
  expect(f!.future[0]).toEqual({ d: '2026-10-24', v: 10 });
});

test('level forecast is the fitted value on the last day', () => {
  const daily = series('2026-07-26', Array.from({ length: 90 }, (_, i) => 100 + i)); // +1/day, 189 on anchor
  const f = forecastFor({ daily, anchor: '2026-10-23', rangeTo: '2026-10-31', kind: 'level', fact: 189 });
  expect(f!.value).toBeCloseTo(197);
});

test('short history gives no forecast; fitted values never go negative', () => {
  expect(forecastFor({ daily: series('2026-10-15', [1, 2, 3]), anchor: '2026-10-23', rangeTo: '2026-10-31', kind: 'flow', fact: 6 })).toBeNull();
  const falling = series('2026-07-26', Array.from({ length: 90 }, (_, i) => 90 - i));
  const f = forecastFor({ daily: falling, anchor: '2026-10-23', rangeTo: '2026-12-31', kind: 'flow', fact: 0 });
  expect(f!.future.every((p) => p.v >= 0)).toBe(true);
});

test('plan shapes', () => {
  const range = { from: '2026-10-01', to: '2026-10-03' };
  expect(planForRange(series('2026-10-01', [5, 5, 5]), range, 'daily')).toBe(15);
  expect(planForRange(series('2026-09-30', [999, 10, 20, 30]), range, 'cumulative')).toBe(30); // restart at range start
  expect(planForRange(series('2026-09-30', [10, 20, 30, 40]), { from: '2026-10-01', to: '2026-10-02' }, 'cumulative')).toBe(20);
  expect(planForRange(series('2026-10-01', [7, 8]), range, 'level')).toBe(8);
  expect(planForRange(new Map(), range, 'daily')).toBeNull();
});

test('levelAt picks the last day with data', () => {
  expect(levelAt(series('2026-10-01', [1, 2]), { from: '2026-10-01', to: '2026-10-05' })).toBe(2);
  expect(levelAt(new Map(), { from: '2026-10-01', to: '2026-10-05' })).toBeNull();
});

test.each([
  [110, 100, 'above'], [100, 100, 'near'], [85, 100, 'near'], [80, 100, 'near'], [79, 100, 'below'],
  [50, null, 'neutral'], [50, 0, 'neutral'], [null, 100, 'neutral'],
] as const)('status %s vs %s', (value, plan, expected) => {
  expect(statusOf(value, plan, 20)).toBe(expected);
});

test('trend and diff', () => {
  const w = { from: '2026-10-01', to: '2026-10-03' };
  expect(trendOf(series('2026-10-01', [1, 2, 3]), w)).toBe('up');
  expect(trendOf(series('2026-10-01', [3, 2, 1]), w)).toBe('down');
  expect(trendOf(series('2026-10-01', [2, 2, 2]), w)).toBe('flat');
  expect(diffPct(110, 100)).toBeCloseTo(10);
  expect(diffPct(90, -100)).toBeCloseTo(190);
  expect(diffPct(1, 0)).toBeNull();
  expect(diffPct(null, 1)).toBeNull();
});
```

`src/lib/format.test.ts`:

```ts
import { compact, formatPct, metricLabel } from './format';

test.each([[964, '964'], [7148, '7.15K'], [1_240_000, '1.24M'], [12.345, '12.3'], [0, '0'], [null, '—']] as const)(
  'compact %s', (n, s) => expect(compact(n)).toBe(s),
);

test('formatPct', () => {
  expect(formatPct(8.333)).toBe('+8.3%');
  expect(formatPct(-4)).toBe('−4.0%');
  expect(formatPct(0)).toBe('0.0%');
  expect(formatPct(null)).toBe('');
});

test('labels never say Unique Count', () => {
  expect(metricLabel('ARR', 'Customers', false)).toBe('ARR from Customers');
  expect(metricLabel('Customers', 'Customers', true)).toBe('Customers');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --maxWorkers=4 src/lib/stats.test.ts src/lib/format.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/lib/stats.ts`**

```ts
import type { DateWindow, Day, MetricKind, PlanShape, Status, Trend } from '../types';
import { addDays, diffDays, eachDay } from './dates';

export type DailyMap = Map<Day, number>;

export function linearFit(points: { x: number; y: number }[]): { slope: number; intercept: number } | null {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const { x, y } of points) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const den = n * sxx - sx * sx;
  if (den === 0) return null;
  const slope = (n * sxy - sx * sy) / den;
  return { slope, intercept: (sy - slope * sx) / n };
}

const HISTORY_DAYS = 90;
const MIN_HISTORY = 14;

export function forecastFor(args: { daily: DailyMap; anchor: Day; rangeTo: Day; kind: MetricKind; fact: number | null }) {
  const { daily, anchor, rangeTo, kind, fact } = args;
  const start = addDays(anchor, -(HISTORY_DAYS - 1));
  const points = eachDay({ from: start, to: anchor })
    .filter((d) => daily.has(d))
    .map((d) => ({ x: diffDays(start, d), y: daily.get(d)! }));
  if (points.length < MIN_HISTORY) return null;
  const fit = linearFit(points);
  if (!fit) return null;
  const at = (d: Day) => Math.max(0, fit.intercept + fit.slope * diffDays(start, d));
  const future = rangeTo > anchor ? eachDay({ from: addDays(anchor, 1), to: rangeTo }).map((d) => ({ d, v: at(d) })) : [];
  const value = kind === 'level' ? at(rangeTo) : (fact ?? 0) + future.reduce((s, p) => s + p.v, 0);
  return { value, future };
}

export function levelAt(daily: DailyMap, w: DateWindow): number | null {
  const days = eachDay(w);
  for (let i = days.length - 1; i >= 0; i--) {
    const v = daily.get(days[i]!);
    if (v !== undefined) return v;
  }
  return null;
}

export function planForRange(plan: DailyMap, range: DateWindow, shape: PlanShape): number | null {
  if (shape === 'daily') {
    const values = eachDay(range).map((d) => plan.get(d)).filter((v): v is number => v !== undefined);
    return values.length ? values.reduce((s, v) => s + v, 0) : null;
  }
  const end = levelAt(plan, range);
  if (shape === 'level' || end === null) return end;
  const base = plan.get(addDays(range.from, -1));
  const first = plan.get(range.from);
  if (base === undefined || (first !== undefined && base > first)) return end;
  return end - base;
}

export function statusOf(value: number | null, plan: number | null, thresholdPct: number): Status {
  if (value === null || plan === null || plan === 0) return 'neutral';
  const gap = (value - plan) / Math.abs(plan);
  if (gap > 0) return 'above';
  return gap >= -thresholdPct / 100 ? 'near' : 'below';
}

export function trendOf(daily: DailyMap, w: DateWindow): Trend {
  const points = eachDay(w)
    .filter((d) => daily.has(d))
    .map((d) => ({ x: diffDays(w.from, d), y: daily.get(d)! }));
  const fit = linearFit(points);
  if (!fit || fit.slope === 0) return 'flat';
  return fit.slope > 0 ? 'up' : 'down';
}

export function diffPct(fact: number | null, comparison: number | null): number | null {
  if (fact === null || comparison === null || comparison === 0) return null;
  return ((fact - comparison) / Math.abs(comparison)) * 100;
}
```

Note the flat case in the trend test: constant values give a slope of exactly 0 with this formula.

- [ ] **Step 4: Implement `src/lib/format.ts`**

```ts
const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 });

export const compact = (n: number | null): string => (n === null ? '—' : COMPACT.format(n));

export function formatPct(p: number | null): string {
  if (p === null) return '';
  const s = Math.abs(p).toFixed(1);
  if (s === '0.0') return '0.0%';
  return `${p > 0 ? '+' : '−'}${s}%`;
}

export const metricLabel = (alias: string, classTitle: string, isUniqueCount: boolean): string =>
  isUniqueCount ? classTitle : `${alias} from ${classTitle}`;
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --maxWorkers=4 src/lib/stats.test.ts src/lib/format.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stats.ts src/lib/stats.test.ts src/lib/format.ts src/lib/format.test.ts
git commit -m "feat(lib): forecast, plan shapes, status, trend and number formatting"
```

---

### Task 5: OWOX sources and helpers (`src/owox/sources.ts`, `src/lib/pool.ts`, `src/lib/hash.ts`, `src/lib/errors.ts`)

**Files:**
- Create: `src/owox/sources.ts`, `src/owox/sources.test.ts`, `src/owox/fake.ts`, `src/lib/pool.ts`, `src/lib/pool.test.ts`, `src/lib/hash.ts`, `src/lib/errors.ts`

**Interfaces:**
- Produces from `src/owox/sources.ts`:

```ts
export interface SchemaField {
  name: string; type: string; alias?: string; description?: string;
  isPrimaryKey: boolean; isHiddenForReporting?: boolean;
  allowedAggregations?: string[];
  calculated?: { formula: string; level?: 'metric' | 'column' };
  fields?: SchemaField[];
}
export interface MartSummary { id: string; title: string; status: string; description: string | null; contexts: { id: string; name: string }[]; modifiedAt: string }
export interface MartDetail { id: string; title: string; fields: SchemaField[] }
export interface AvailableSource { aliasPath: string; dataMartId: string; title: string; isAccessibleForReporting: boolean }
export interface Blendable { availableSources: AvailableSource[]; mainUniqueCountKeyFields: string[] }
export interface ContextInfo { id: string; name: string; description: string | null }
export interface Inputs { projectDescription: string | null; contexts: ContextInfo[]; marts: MartSummary[] }

/** The subset of ctx.owox Gyroscope uses. ctx.owox satisfies it. */
export interface OwoxLike {
  getJson<T>(path: string, query?: Record<string, unknown>): Promise<T>;
  project: { getSettings(): Promise<{ description: string | null }> };
  dataMarts: {
    list(): Promise<MartSummary[]>;
    traverseData(id: string, options: Record<string, unknown>): Promise<{ rowChunks(): AsyncIterable<Record<string, unknown>[]> }>;
  };
}

export function fetchInputs(owox: OwoxLike): Promise<Inputs>;          // published marts only
export function fetchMartDetail(owox: OwoxLike, id: string): Promise<MartDetail>;
export function fetchBlendable(owox: OwoxLike, id: string): Promise<Blendable>;
export function flattenFields(fields: SchemaField[]): { path: string; field: SchemaField }[]; // dotted paths, skips hidden subtrees
export const DATE_TYPES: ReadonlySet<string>; // DATE, DATETIME, TIMESTAMP, TIMESTAMP_NTZ, TIMESTAMP_TZ, TIMESTAMP_LTZ
```

- Produces from helpers:
  - `runPool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]>` (results in task order)
  - `hashString(s: string): string` (FNV-1a 32-bit, 8 lowercase hex chars)
  - `describeError(error: unknown): string`
- Produces from `src/owox/fake.ts` (test helper used by Tasks 7, 8 and 12):

```ts
export interface FakeOwoxData {
  projectDescription: string | null;
  contexts: ContextInfo[];
  marts: MartSummary[];
  details: Record<string, MartDetail>;
  blendables: Record<string, Blendable>;
  /** Returns rows for a traverseData call; tests inspect the options. */
  rows?: (id: string, options: Record<string, unknown>) => Record<string, unknown>[];
}
export function fakeOwox(data: FakeOwoxData): OwoxLike & { calls: { path: string }[] };
```

`fetchInputs` uses `owox.project.getSettings()`, `owox.getJson<ContextInfo[]>('/api/contexts')` and `owox.dataMarts.list()`, filtered to `status === 'PUBLISHED'`. A context `description` that is not a string becomes `null`. `fetchMartDetail` reads `GET /api/data-marts/{id}` and returns `schema?.fields ?? []`. `fetchBlendable` reads `GET /api/data-marts/{id}/blendable-schema` and keeps the four `AvailableSource` keys plus `mainUniqueCountKeyFields`.

- [ ] **Step 1: Write the failing tests**

`src/lib/pool.test.ts`:

```ts
import { runPool } from './pool';

test('keeps order, caps concurrency, settles failures', async () => {
  let active = 0, peak = 0;
  const task = (v: number, fail = false) => async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    if (fail) throw new Error(`bad ${v}`);
    return v;
  };
  const res = await runPool([task(1), task(2, true), task(3), task(4), task(5)], 2);
  expect(peak).toBe(2);
  expect(res.map((r) => (r.status === 'fulfilled' ? r.value : (r.reason as Error).message))).toEqual([1, 'bad 2', 3, 4, 5]);
});
```

`src/owox/sources.test.ts`:

```ts
import { fetchBlendable, fetchInputs, fetchMartDetail, flattenFields } from './sources';
import { fakeOwox } from './fake';

const owox = fakeOwox({
  projectDescription: '# Goal',
  contexts: [{ id: 'c1', name: 'Growth', description: { weird: true } as never }],
  marts: [
    { id: 'm1', title: 'Customers', status: 'PUBLISHED', description: null, contexts: [], modifiedAt: 't1' },
    { id: 'm2', title: 'Draft', status: 'DRAFT', description: null, contexts: [], modifiedAt: 't2' },
  ],
  details: { m1: { id: 'm1', title: 'Customers', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }] } },
  blendables: { m1: { availableSources: [], mainUniqueCountKeyFields: ['id'] } },
});

test('fetchInputs keeps published marts and normalises context descriptions', async () => {
  const inputs = await fetchInputs(owox);
  expect(inputs.projectDescription).toBe('# Goal');
  expect(inputs.contexts).toEqual([{ id: 'c1', name: 'Growth', description: null }]);
  expect(inputs.marts.map((m) => m.id)).toEqual(['m1']);
});

test('detail and blendable', async () => {
  expect((await fetchMartDetail(owox, 'm1')).fields[0]!.name).toBe('id');
  expect((await fetchBlendable(owox, 'm1')).mainUniqueCountKeyFields).toEqual(['id']);
});

test('flattenFields builds dotted paths and skips hidden subtrees', () => {
  expect(flattenFields([
    { name: 'a', type: 'RECORD', isPrimaryKey: false, fields: [{ name: 'b', type: 'INTEGER', isPrimaryKey: false }] },
    { name: 'h', type: 'RECORD', isPrimaryKey: false, isHiddenForReporting: true, fields: [{ name: 'x', type: 'STRING', isPrimaryKey: false }] },
  ]).map((f) => f.path)).toEqual(['a', 'a.b']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --maxWorkers=4 src/lib/pool.test.ts src/owox/sources.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement helpers**

`src/lib/pool.ts`:

```ts
export async function runPool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try { results[i] = { status: 'fulfilled', value: await tasks[i]!() }; }
      catch (reason) { results[i] = { status: 'rejected', reason }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
```

`src/lib/hash.ts`:

```ts
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
```

`src/lib/errors.ts` (from the guide's "Handle request errors"):

```ts
import type { PluginErrorPayload } from '@owox/plugin-sdk';

export function describeError(error: unknown): string {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (current.name === 'PluginTransportError' && 'payload' in current) {
      const { code, status, message } = current.payload as PluginErrorPayload;
      return [code, status, message].filter(Boolean).join(' ');
    }
  }
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: Implement `src/owox/sources.ts` and `src/owox/fake.ts`**

`src/owox/sources.ts`: the interfaces from the Interfaces block, plus:

```ts
export const DATE_TYPES: ReadonlySet<string> = new Set(['DATE', 'DATETIME', 'TIMESTAMP', 'TIMESTAMP_NTZ', 'TIMESTAMP_TZ', 'TIMESTAMP_LTZ']);

export async function fetchInputs(owox: OwoxLike): Promise<Inputs> {
  const [settings, contexts, marts] = await Promise.all([
    owox.project.getSettings(),
    owox.getJson<{ id: string; name: string; description?: unknown }[]>('/api/contexts'),
    owox.dataMarts.list(),
  ]);
  return {
    projectDescription: settings.description,
    contexts: contexts.map((c) => ({ id: c.id, name: c.name, description: typeof c.description === 'string' ? c.description : null })),
    marts: marts.filter((m) => m.status === 'PUBLISHED'),
  };
}

export async function fetchMartDetail(owox: OwoxLike, id: string): Promise<MartDetail> {
  const dm = await owox.getJson<{ id: string; title: string; schema?: { fields?: SchemaField[] } | null }>(`/api/data-marts/${id}`);
  return { id: dm.id, title: dm.title, fields: dm.schema?.fields ?? [] };
}

export async function fetchBlendable(owox: OwoxLike, id: string): Promise<Blendable> {
  const b = await owox.getJson<{ availableSources?: AvailableSource[]; mainUniqueCountKeyFields?: string[] }>(`/api/data-marts/${id}/blendable-schema`);
  return {
    availableSources: (b.availableSources ?? []).map(({ aliasPath, dataMartId, title, isAccessibleForReporting }) => ({ aliasPath, dataMartId, title, isAccessibleForReporting })),
    mainUniqueCountKeyFields: b.mainUniqueCountKeyFields ?? [],
  };
}

export function flattenFields(fields: SchemaField[], prefix = ''): { path: string; field: SchemaField }[] {
  return fields.flatMap((f) => {
    if (f.isHiddenForReporting) return [];
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    return [{ path, field: f }, ...flattenFields(f.fields ?? [], path)];
  });
}
```

`src/owox/fake.ts`:

```ts
import type { Blendable, ContextInfo, MartDetail, MartSummary, OwoxLike } from './sources';

export interface FakeOwoxData {
  projectDescription: string | null;
  contexts: ContextInfo[];
  marts: MartSummary[];
  details: Record<string, MartDetail>;
  blendables: Record<string, Blendable>;
  rows?: (id: string, options: Record<string, unknown>) => Record<string, unknown>[];
}

export function fakeOwox(data: FakeOwoxData): OwoxLike & { calls: { path: string }[] } {
  const calls: { path: string }[] = [];
  const miss = (path: string) => Object.assign(new Error(`404 ${path}`), { status: 404 });
  return {
    calls,
    async getJson<T>(path: string): Promise<T> {
      calls.push({ path });
      if (path === '/api/contexts') return data.contexts as T;
      const blend = /^\/api\/data-marts\/([^/]+)\/blendable-schema$/.exec(path);
      if (blend) { const b = data.blendables[blend[1]!]; if (!b) throw miss(path); return b as T; }
      const one = /^\/api\/data-marts\/([^/]+)$/.exec(path);
      if (one) { const d = data.details[one[1]!]; if (!d) throw miss(path); return { id: d.id, title: d.title, schema: { fields: d.fields } } as T; }
      throw miss(path);
    },
    project: { getSettings: async () => ({ description: data.projectDescription }) },
    dataMarts: {
      list: async () => data.marts,
      traverseData: async (id, options) => {
        calls.push({ path: `traverse:${id}` });
        const rows = data.rows?.(id, options) ?? [];
        return { async *rowChunks() { yield rows; } };
      },
    },
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --maxWorkers=4 src/lib/pool.test.ts src/owox/sources.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/owox src/lib/pool.ts src/lib/pool.test.ts src/lib/hash.ts src/lib/errors.ts
git commit -m "feat(owox): typed sources over ctx.owox, request pool, hash, error text"
```

---

### Task 6: Connection graph and main class (`src/model/graph.ts`)

**Files:**
- Create: `src/model/graph.ts`, `src/model/graph.test.ts`

**Interfaces:**
- Consumes: `parseRefs` from `../lib/refs`; `MartDetail`, `Blendable`, `SchemaField` from `../owox/sources`; `Edge` from `../types`.
- Produces:

```ts
export interface MartNode {
  id: string; title: string;
  contexts: { id: string; name: string }[];
  detail: MartDetail;
  blendable: Blendable;
}
export interface RefEdge extends Edge { refFields: string[] } // target fields referenced
/** Edges A -> B from A's top-level calculated fields. `visible` is the set of mart ids the member can see. */
export function buildEdges(nodes: MartNode[], visible: ReadonlySet<string>, allowHiddenTarget?: string): RefEdge[];
export function hasPrimaryKey(detail: MartDetail): boolean;
/** Main class id, or null when no visible mart connects to the goal. */
export function chooseMain(args: { goalMartId: string; goalField: string; nodes: MartNode[]; visible: ReadonlySet<string> }): { id: string; viaFallback: boolean } | null;
/** BFS from main along edges; only marts with a primary key; returns depth per class id. */
export function classDepths(mainId: string, edges: Edge[], withPk: ReadonlySet<string>): Map<string, number>;
```

Edge rules (spec 5.3):

1. Only top-level fields with `calculated` count. A ref with `path === ''` makes no edge.
2. For path `a.b.c`, each prefix `a`, `a.b`, `a.b.c` must be an `availableSources[].aliasPath` with `isAccessibleForReporting: true` whose `dataMartId` is in `visible`. The last prefix's `dataMartId` is the target. The one exception: when `allowHiddenTarget` equals the last prefix's `dataMartId`, that last mart may be hidden (used to find marts pointing at a hidden goal).
3. No self edges. Edges are deduplicated by `from`+`to`, merging `refFields`. Output is sorted by `from`, then `to`.

`chooseMain`:

1. If `goalMartId` is in `visible`, return `{ id: goalMartId, viaFallback: false }`.
2. Otherwise build edges with `allowHiddenTarget = goalMartId` and keep those ending at the goal. A mart two steps away would need a visible mart one step away, so the nearest marts are always the direct referrers. Among them, prefer a mart whose edge to the goal lists `goalField` in `refFields`, then the smallest `title` by `localeCompare`. Return `{ id, viaFallback: true }`, or null when nothing reaches the goal.

`classDepths`: start at `mainId` (always included, depth 0, even without a primary key). Follow `from → to` edges; enqueue a target only if it is in `withPk` and not yet seen.

- [ ] **Step 1: Write the failing tests**

```ts
import { buildEdges, chooseMain, classDepths, hasPrimaryKey, type MartNode } from './graph';

const field = (name: string, formula?: string, pk = false) => ({ name, type: 'FLOAT', isPrimaryKey: pk, ...(formula ? { calculated: { formula } } : {}) });
const src = (aliasPath: string, dataMartId: string, ok = true) => ({ aliasPath, dataMartId, title: dataMartId, isAccessibleForReporting: ok });
const node = (id: string, fields: ReturnType<typeof field>[], sources: ReturnType<typeof src>[] = []): MartNode => ({
  id, title: id.toUpperCase(), contexts: [], detail: { id, title: id.toUpperCase(), fields }, blendable: { availableSources: sources, mainUniqueCountKeyFields: [] },
});

const nodes = [
  node('orders', [field('id', undefined, true), field('rev', `SUM({{ref field="amount"}})`), field('ltv', `AVG({{ ref path='customers' field='ltv' }})`)], [src('customers', 'customers')]),
  node('customers', [field('id', undefined, true), field('x', `SUM({{ref path="secret.pages" field="views"}})`)], [src('secret', 'secret'), src('secret.pages', 'pages')]),
  node('pages', [field('id', undefined, true)]),
];

test('edges come from calculated refs with a path; hidden hops break them', () => {
  const visible = new Set(['orders', 'customers', 'pages']);
  expect(buildEdges(nodes, visible)).toEqual([{ from: 'orders', to: 'customers', refFields: ['ltv'] }]);
});

test('main is the goal mart when visible', () => {
  expect(chooseMain({ goalMartId: 'orders', goalField: 'rev', nodes, visible: new Set(['orders', 'customers']) })).toEqual({ id: 'orders', viaFallback: false });
});

test('hidden goal falls back to the nearest visible mart, preferring one that references the goal field', () => {
  const ns = [
    node('a', [field('k', `SUM({{ref path="g" field="arr"}})`)], [src('g', 'goal')]),
    node('b', [field('k', `SUM({{ref path="g" field="other"}})`)], [src('g', 'goal')]),
  ];
  expect(chooseMain({ goalMartId: 'goal', goalField: 'arr', nodes: ns, visible: new Set(['a', 'b']) })).toEqual({ id: 'a', viaFallback: true });
  expect(chooseMain({ goalMartId: 'goal', goalField: 'zzz', nodes: ns, visible: new Set(['a', 'b']) })).toEqual({ id: 'a', viaFallback: true });
  expect(chooseMain({ goalMartId: 'goal', goalField: 'arr', nodes: [], visible: new Set() })).toBeNull();
});

test('depths follow edges and skip marts without a primary key', () => {
  const edges = [{ from: 'm', to: 'a' }, { from: 'a', to: 'b' }, { from: 'm', to: 'nopk' }, { from: 'nopk', to: 'c' }];
  expect([...classDepths('m', edges, new Set(['a', 'b', 'c']))]).toEqual([['m', 0], ['a', 1], ['b', 2]]);
});

test('hasPrimaryKey looks at nested fields too', () => {
  expect(hasPrimaryKey({ id: 'x', title: 'X', fields: [{ name: 'r', type: 'RECORD', isPrimaryKey: false, fields: [{ name: 'k', type: 'STRING', isPrimaryKey: true }] }] })).toBe(true);
  expect(hasPrimaryKey({ id: 'x', title: 'X', fields: [] })).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --maxWorkers=4 src/model/graph.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/model/graph.ts`**

```ts
import type { Edge } from '../types';
import { parseRefs } from '../lib/refs';
import type { Blendable, MartDetail, SchemaField } from '../owox/sources';

export interface MartNode {
  id: string; title: string;
  contexts: { id: string; name: string }[];
  detail: MartDetail;
  blendable: Blendable;
}
export interface RefEdge extends Edge { refFields: string[] }

export function hasPrimaryKey(detail: MartDetail): boolean {
  const walk = (fs: SchemaField[]): boolean => fs.some((f) => f.isPrimaryKey || walk(f.fields ?? []));
  return walk(detail.fields);
}

function resolveTarget(path: string, b: Blendable, visible: ReadonlySet<string>, allowHiddenTarget?: string): string | null {
  const segs = path.split('.');
  let target: string | null = null;
  for (let i = 1; i <= segs.length; i++) {
    const prefix = segs.slice(0, i).join('.');
    const s = b.availableSources.find((x) => x.aliasPath === prefix);
    if (!s || !s.isAccessibleForReporting) return null;
    const last = i === segs.length;
    if (!visible.has(s.dataMartId) && !(last && s.dataMartId === allowHiddenTarget)) return null;
    target = s.dataMartId;
  }
  return target;
}

export function buildEdges(nodes: MartNode[], visible: ReadonlySet<string>, allowHiddenTarget?: string): RefEdge[] {
  const byKey = new Map<string, RefEdge>();
  for (const n of nodes) {
    for (const f of n.detail.fields) {
      if (!f.calculated) continue;
      for (const ref of parseRefs(f.calculated.formula)) {
        if (!ref.path) continue;
        const to = resolveTarget(ref.path, n.blendable, visible, allowHiddenTarget);
        if (!to || to === n.id) continue;
        const key = `${n.id}\u0000${to}`;
        const e = byKey.get(key) ?? { from: n.id, to, refFields: [] };
        if (!e.refFields.includes(ref.field)) e.refFields.push(ref.field);
        byKey.set(key, e);
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

export function chooseMain(args: { goalMartId: string; goalField: string; nodes: MartNode[]; visible: ReadonlySet<string> }) {
  const { goalMartId, goalField, nodes, visible } = args;
  if (visible.has(goalMartId)) return { id: goalMartId, viaFallback: false };
  // A mart two steps away needs a visible mart one step away, so only direct referrers can win.
  const toGoal = buildEdges(nodes, visible, goalMartId).filter((e) => e.to === goalMartId);
  if (!toGoal.length) return null;
  const title = new Map(nodes.map((n) => [n.id, n.title]));
  toGoal.sort((a, b) =>
    Number(b.refFields.includes(goalField)) - Number(a.refFields.includes(goalField)) ||
    (title.get(a.from) ?? a.from).localeCompare(title.get(b.from) ?? b.from));
  return { id: toGoal[0]!.from, viaFallback: true };
}

export function classDepths(mainId: string, edges: Edge[], withPk: ReadonlySet<string>): Map<string, number> {
  const depth = new Map([[mainId, 0]]);
  const queue = [mainId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of edges) {
      if (e.from !== cur || depth.has(e.to) || !withPk.has(e.to)) continue;
      depth.set(e.to, depth.get(cur)! + 1);
      queue.push(e.to);
    }
  }
  return depth;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --maxWorkers=4 src/model/graph.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/graph.ts src/model/graph.test.ts
git commit -m "feat(model): connections from calculated-field refs and main class choice"
```

---

### Task 7: Interpret, validate and build the model (`src/model/interpret.ts`, `validate.ts`, `build.ts`)

**Files:**
- Create: `src/model/interpret.ts`, `src/model/interpret.test.ts`, `src/model/validate.ts`, `src/model/validate.test.ts`, `src/model/build.ts`, `src/model/build.test.ts`

**Interfaces:**
- Consumes: `extractLinks`, `MartLink` (Task 3); `fetchInputs`, `fetchMartDetail`, `fetchBlendable`, `flattenFields`, `DATE_TYPES`, `OwoxLike`, `Inputs`, `MartDetail`, `Blendable` (Task 5); `runPool`, `hashString` (Task 5); `buildEdges`, `chooseMain`, `classDepths`, `hasPrimaryKey`, `MartNode` (Task 6); types from `../types`.
- Produces:

```ts
// interpret.ts
export const AiOutputSchema: z.ZodType<AiOutput>;
export interface AiMetric {
  ref: string;                       // 'm1', 'm2' ...
  role: 'critical' | 'leading' | 'lagging';
  source: string;                    // 'project' or a context id
  alias: string;
  factLink: number | null;           // MartLink.index
  planLink: number | null;
  kind: 'flow' | 'level';
  planShape: 'daily' | 'cumulative' | 'level' | null;
  factDateField: string | null;
  planDateField: string | null;
  aggregation: 'SUM' | 'COUNT' | 'COUNT_DISTINCT' | 'AVG' | 'MIN' | 'MAX' | null;
}
export interface AiOutput { goal: { status: 'ok' | 'missing' | 'placeholder'; metricRef: string | null; note: string }; metrics: AiMetric[] }
export interface InterpretInput { projectDescription: string | null; contexts: { id: string; name: string; description: string | null }[]; links: MartLink[]; dateFields: Record<string, string[]> }
export type Generate = (prompt: string) => Promise<unknown>;   // returns the raw structured output
export function buildPrompt(input: InterpretInput): string;
export async function interpret(generate: Generate, input: InterpretInput): Promise<AiOutput>; // throws on schema mismatch
export function aiGenerate(model: unknown, signal?: AbortSignal): Generate;                   // wraps ai@7 generateText + Output.object

// validate.ts
export interface ValidateInput { ai: AiOutput; links: MartLink[]; details: Map<string, MartDetail>; visible: ReadonlySet<string> }
export type ValidateResult =
  | { ok: true; goal: { martId: string; field: string; metricId: string }; metrics: MetricDef[] }
  | { ok: false; blocked: Blocked };
export function validate(input: ValidateInput): ValidateResult;
export function uniqueCountMetric(detail: MartDetail, blendable: Blendable): MetricDef | null;
export function metricId(martId: string, m: Measure): string;

// build.ts
export function inputHash(inputs: Inputs): string;
export async function buildModel(args: { owox: OwoxLike; generate: Generate | null; userId: string; now: Date }): Promise<BuildResult>;
```

**Prompt.** `buildPrompt` returns one string with these parts, in order:

1. The task: "You read an OWOX project's descriptions and list the metrics they define. Answer only from the text and the numbered links below. Never invent links or fields."
2. "PROJECT DESCRIPTION:" and the text, or "(empty)".
3. One block per context with a non-null description: "CONTEXT <id> (<name>):" and the text.
4. "LINKS:" then one line per link: `<index>: [<text>] mart=<martId or PLACEHOLDER> field=<field or none> source=<source>`.
5. "DATE FIELDS:" then one line per mart id: `<martId>: <comma-separated date field paths>`.
6. The rules:
   1. The goal is the "Critical number" row in the PROJECT DESCRIPTION's metrics table. If there is no such row, `goal.status` is "missing". If its fact link is a PLACEHOLDER link or is absent, `goal.status` is "placeholder".
   2. One metric per metrics-table row in the project and in each context. `source` is "project" or the context id. `alias` is the metric name in the row without units, for example "ARR" for "ARR, $".
   3. `factLink` and `planLink` are link indexes from LINKS, or null.
   4. `kind` is "level" when the text says the value is a snapshot or must not be summed across days, else "flow".
   5. `planShape` is "cumulative" when plan values accumulate from a period start, "level" when the plan is a per-day level, else "daily". Null without a plan link.
   6. `factDateField` and `planDateField` come only from DATE FIELDS for that link's mart. Prefer a field the text names as the date field for the period.
   7. `aggregation` is null unless the text says how to aggregate.
   8. `ref` values are "m1", "m2", … in reading order. `goal.metricRef` is the goal row's ref.

**`aiGenerate`:**

```ts
import { generateText, Output } from 'ai';

export function aiGenerate(model: unknown, signal?: AbortSignal): Generate {
  return async (prompt) => {
    const { output } = await generateText({
      model: model as never, // the SDK's provider-v4 handle; ai@7 accepts LanguageModelV4
      output: Output.object({ schema: AiOutputSchema }),
      prompt,
      temperature: 0,
      abortSignal: signal,
    });
    return output;
  };
}
```

`interpret` calls `generate(buildPrompt(input))`, then `AiOutputSchema.safeParse`. On failure it throws `Error('AI_INVALID: ' + issues)`.

**`validate` rules, in order.**

1. `ai.goal.status === 'missing'` → blocked `NO_GOAL`, detail "The project description has no Critical number in its metrics table."
2. `ai.goal.status === 'placeholder'`, or the goal metric is not found, or its `factLink` is null or points at a placeholder link → blocked `GOAL_PLACEHOLDER`, detail names the link text and URL when there is one.
3. Let `goalLink = links[factLink]`. If the mart is visible and its detail has no field at `goalLink.field` (match `flattenFields` paths) → `GOAL_FIELD_NOT_FOUND`, detail "`<field>` is not a field of <mart title>."
4. If the mart is visible and `hasPrimaryKey(detail)` is false → `GOAL_NO_PRIMARY_KEY`.
5. For every metric (goal included) whose fact link points at a visible mart, check: the field exists, `factDateField` is a date-type path of that mart, `aggregation` (when given and the field is not calculated) is in `allowedAggregations` (when that list exists). Each failure appends a mismatch string like `ARR → field "arr_total" not found in Fact. Product ARR. Daily`. A metric whose fact mart is hidden is dropped without a mismatch, except the goal, whose hidden mart is handled by `chooseMain` in `buildModel`.
6. Plan: when `planLink` points at a visible mart, check field and `planDateField` the same way and append mismatches. A plan on a hidden mart is dropped.
7. Any mismatches → blocked `AI_INVALID`, detail "The AI's reading of the descriptions doesn't match the Data Mart schemas.", `mismatches` listed.
8. Measure: a field with `calculated` and `level !== 'column'` gets `fn: null`. Otherwise `fn` is the AI aggregation, else `'SUM'` when allowed (or no list), else the first entry of `allowedAggregations`.

`uniqueCountMetric(detail, blendable)` returns null unless `blendable.mainUniqueCountKeyFields.length === 1`. Otherwise it returns `{ alias: detail.title, measure: { field: key, fn: 'COUNT_DISTINCT' }, kind: 'flow', role: 'unique', source: 'schema', isUniqueCount: true, plan: null, dateField }` where `dateField` is the first date-type path among primary-key fields, else the first date-type path whose name matches `/creat|date|time/i`, else the first date-type path, else null.

**`inputHash(inputs)`:** `hashString(JSON.stringify([projectDescription, contexts.map(c => [c.id, c.description]), marts.map(m => [m.id, m.modifiedAt]).sort()]))`.

**`buildModel` steps:**

1. `generate` null → `{ ok: false, blocked: { code: 'AI_NOT_CONFIGURED', detail: 'Ask a project admin to map an AI model to this plugin.', mismatches: [] } }`.
2. `inputs = await fetchInputs(owox)`; `visible = new Set(inputs.marts.map(m => m.id))`.
3. `links` = project links from index 0, then each context's links continuing the index.
4. Fetch details for every visible mart referenced by a link (`runPool`, limit 6). `dateFields[martId]` = date-type `flattenFields` paths.
5. `ai = await interpret(generate, …)`; a thrown error becomes `AI_INVALID` with the message as the only mismatch.
6. `v = validate(...)`; blocked → return it.
7. Fetch details and blendables for all visible marts (`runPool`, limit 6; reuse step 4 details). Failed fetches drop that mart. Build `MartNode[]`.
8. `main = chooseMain({ goalMartId, goalField, nodes, visible })`; null → `GOAL_NOT_CONNECTED`, detail "None of the Data Marts you can see reference <goal link text> through a calculated field."
9. `edges = buildEdges(nodes, visible)`. `withPk` = ids of nodes with `hasPrimaryKey`. `depths = classDepths(main.id, edges, withPk)`.
10. For each class: metrics = validated metrics with `martId === class id`, plus `uniqueCountMetric` when non-null. Sort by role rank: the project's critical (`source === 'project'`) 0, context critical 1, leading 2, lagging 3, unique 4; ties keep AI order. `keyMetricId` = first or null.
11. `edges` in the model = `{ from, to }` (drop `refFields`) for edges whose both ends are classes.
12. Return `{ ok: true, model: { version: 1, inputHash, builtAt: now.toISOString(), builtBy: userId, goal: { classId: main.id, metricId: main.viaFallback ? null : v.goal.metricId, goalMartId, viaFallback }, classes (sorted by depth then title), edges, metrics (only those attached to a class) } }`.

- [ ] **Step 1: Write the failing tests**

`src/model/interpret.test.ts`:

```ts
import { buildPrompt, interpret } from './interpret';

const input = {
  projectDescription: '| Critical number | ARR | [ARR](x) |',
  contexts: [{ id: 'c1', name: 'Growth', description: 'Visitors are unique per period.' }, { id: 'c2', name: 'HR', description: null }],
  links: [{ index: 0, source: 'project', text: 'ARR', url: 'u', martId: 'm1', field: 'arr', placeholder: false }],
  dateFields: { m1: ['date'] },
};

test('prompt lists links, date fields and skips empty contexts', () => {
  const p = buildPrompt(input);
  expect(p).toContain('0: [ARR] mart=m1 field=arr source=project');
  expect(p).toContain('m1: date');
  expect(p).toContain('CONTEXT c1 (Growth):');
  expect(p).not.toContain('CONTEXT c2');
});

test('valid output passes, invalid output throws AI_INVALID', async () => {
  const good = { goal: { status: 'ok', metricRef: 'm1', note: '' }, metrics: [{ ref: 'm1', role: 'critical', source: 'project', alias: 'ARR', factLink: 0, planLink: null, kind: 'level', planShape: null, factDateField: 'date', planDateField: null, aggregation: null }] };
  await expect(interpret(async () => good, input)).resolves.toEqual(good);
  await expect(interpret(async () => ({ goal: {} }), input)).rejects.toThrow(/^AI_INVALID/);
});
```

`src/model/validate.test.ts`:

```ts
import { uniqueCountMetric, validate } from './validate';
import type { AiOutput } from './interpret';

const arrMart = { id: 'm1', title: 'ARR Daily', fields: [
  { name: 'date', type: 'DATE', isPrimaryKey: true }, { name: 'customerId', type: 'STRING', isPrimaryKey: true },
  { name: 'arr', type: 'FLOAT', isPrimaryKey: false, allowedAggregations: ['SUM', 'AVG'] },
] };
const links = [
  { index: 0, source: 'project', text: 'ARR', url: 'u0', martId: 'm1', field: 'arr', placeholder: false },
  { index: 1, source: 'project', text: 'Plan', url: 'u1', martId: null, field: 'arr', placeholder: true },
];
const ai = (over: Partial<AiOutput['metrics'][number]> = {}, goal: Partial<AiOutput['goal']> = {}): AiOutput => ({
  goal: { status: 'ok', metricRef: 'm1', note: '', ...goal },
  metrics: [{ ref: 'm1', role: 'critical', source: 'project', alias: 'ARR', factLink: 0, planLink: null, kind: 'level', planShape: null, factDateField: 'date', planDateField: null, aggregation: null, ...over }],
});
const details = new Map([['m1', arrMart]]);
const visible = new Set(['m1']);

test('happy path builds a level SUM metric', () => {
  const r = validate({ ai: ai(), links, details, visible });
  expect(r.ok && r.metrics[0]).toMatchObject({ martId: 'm1', measure: { field: 'arr', fn: 'SUM' }, kind: 'level', dateField: 'date', role: 'critical' });
});

test.each([
  [ai({}, { status: 'missing' }), 'NO_GOAL'],
  [ai({}, { status: 'placeholder' }), 'GOAL_PLACEHOLDER'],
  [ai({ factLink: 1 }), 'GOAL_PLACEHOLDER'],
  [ai({ factLink: null }), 'GOAL_PLACEHOLDER'],
] as const)('blocked %#', (out, code) => {
  const r = validate({ ai: out, links, details, visible });
  expect(!r.ok && r.blocked.code).toBe(code);
});

test('goal field missing and no primary key', () => {
  const badField = [{ ...links[0]!, field: 'arr_total' }, links[1]!];
  expect(validate({ ai: ai(), links: badField, details, visible })).toMatchObject({ ok: false, blocked: { code: 'GOAL_FIELD_NOT_FOUND' } });
  const noPk = new Map([['m1', { ...arrMart, fields: arrMart.fields.map((f) => ({ ...f, isPrimaryKey: false })) }]]);
  expect(validate({ ai: ai(), links, details: noPk, visible })).toMatchObject({ ok: false, blocked: { code: 'GOAL_NO_PRIMARY_KEY' } });
});

test('wrong date field or aggregation is a mismatch', () => {
  const r = validate({ ai: ai({ factDateField: 'customerId', aggregation: 'MAX' }), links, details, visible });
  expect(r).toMatchObject({ ok: false, blocked: { code: 'AI_INVALID' } });
  expect(!r.ok && r.blocked.mismatches).toHaveLength(2);
});

test('composite primary key has no unique count; single key does', () => {
  expect(uniqueCountMetric(arrMart, { availableSources: [], mainUniqueCountKeyFields: ['date', 'customerId'] })).toBeNull();
  const customers = { id: 'c', title: 'Customers', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'created_at', type: 'TIMESTAMP', isPrimaryKey: false }] };
  expect(uniqueCountMetric(customers, { availableSources: [], mainUniqueCountKeyFields: ['id'] })).toMatchObject({
    alias: 'Customers', measure: { field: 'id', fn: 'COUNT_DISTINCT' }, dateField: 'created_at', isUniqueCount: true,
  });
});
```

`src/model/build.test.ts`:

```ts
import { buildModel } from './build';
import { fakeOwox } from '../owox/fake';

const now = new Date('2026-10-24T10:00:00Z');
const goalAi = {
  goal: { status: 'ok', metricRef: 'm1', note: '' },
  metrics: [{ ref: 'm1', role: 'critical', source: 'project', alias: 'Revenue', factLink: 0, planLink: null, kind: 'flow', planShape: null, factDateField: 'date', planDateField: null, aggregation: null }],
};
const mart = (id: string, title: string) => ({ id, title, status: 'PUBLISHED', description: null, contexts: [], modifiedAt: 't' });
const data = () => ({
  projectDescription: '| Critical number | Revenue | [Revenue](https://app.owox.com/ui/p/data-marts/11111111-1111-1111-1111-111111111111/data-setup?field=revenue) |',
  contexts: [],
  marts: [mart('11111111-1111-1111-1111-111111111111', 'Orders'), mart('c', 'Customers')],
  details: {
    '11111111-1111-1111-1111-111111111111': { id: '11111111-1111-1111-1111-111111111111', title: 'Orders', fields: [
      { name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'date', type: 'DATE', isPrimaryKey: false },
      { name: 'revenue', type: 'FLOAT', isPrimaryKey: false },
      { name: 'cust_ltv', type: 'FLOAT', isPrimaryKey: false, calculated: { formula: 'AVG({{ref path="customers" field="ltv"}})', level: 'metric' as const } },
    ] },
    c: { id: 'c', title: 'Customers', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }] },
  },
  blendables: {
    '11111111-1111-1111-1111-111111111111': { availableSources: [{ aliasPath: 'customers', dataMartId: 'c', title: 'Customers', isAccessibleForReporting: true }], mainUniqueCountKeyFields: ['id'] },
    c: { availableSources: [], mainUniqueCountKeyFields: ['id'] },
  },
});

test('builds main on top and a connected class below', async () => {
  const r = await buildModel({ owox: fakeOwox(data()), generate: async () => goalAi, userId: 'u1', now });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.model.classes.map((c) => [c.title, c.depth])).toEqual([['Orders', 0], ['Customers', 1]]);
  expect(r.model.edges).toEqual([{ from: '11111111-1111-1111-1111-111111111111', to: 'c' }]);
  const orders = r.model.classes[0]!;
  expect(r.model.metrics.find((m) => m.id === orders.keyMetricId)?.alias).toBe('Revenue');
  expect(orders.metricIds).toHaveLength(2); // Revenue, then unique count
});

test('no AI handle blocks', async () => {
  const r = await buildModel({ owox: fakeOwox(data()), generate: null, userId: 'u1', now });
  expect(r).toMatchObject({ ok: false, blocked: { code: 'AI_NOT_CONFIGURED' } });
});

test('null project description reaches NO_GOAL', async () => {
  const d = { ...data(), projectDescription: null };
  const r = await buildModel({ owox: fakeOwox(d), generate: async () => ({ goal: { status: 'missing', metricRef: null, note: '' }, metrics: [] }), userId: 'u1', now });
  expect(r).toMatchObject({ ok: false, blocked: { code: 'NO_GOAL' } });
});

test('hidden goal with no referencing mart is GOAL_NOT_CONNECTED', async () => {
  const d = data();
  d.marts = d.marts.filter((m) => m.id === 'c');
  const r = await buildModel({ owox: fakeOwox(d), generate: async () => goalAi, userId: 'u1', now });
  expect(r).toMatchObject({ ok: false, blocked: { code: 'GOAL_NOT_CONNECTED' } });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --maxWorkers=4 src/model`
Expected: FAIL for the three new test files.

- [ ] **Step 3: Implement `interpret.ts`**

Write `AiOutputSchema` with zod 4 matching `AiOutput` exactly (use `z.enum`, `z.number().int().nullable()`, `z.string().nullable()`). Write `buildPrompt` following the "Prompt" section above, joining parts with blank lines. Write `interpret` and `aiGenerate` as specified.

- [ ] **Step 4: Implement `validate.ts`**

Follow the rules above. Helpers inside the file:

```ts
const pathsOf = (d: MartDetail) => new Map(flattenFields(d.fields).map((x) => [x.path, x.field]));
const isDateField = (f: SchemaField | undefined) => !!f && DATE_TYPES.has(f.type.toUpperCase());
export const metricId = (martId: string, m: Measure) => `${martId}:${m.field}:${m.fn ?? 'calc'}`;
```

- [ ] **Step 5: Implement `build.ts`**

Follow the `buildModel` steps above.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run --maxWorkers=4 src/model`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/model
git commit -m "feat(model): AI reading of descriptions, schema validation and model build"
```

---

### Task 8: Metric queries and refresh (`src/metrics/*`)

**Files:**
- Create: `src/metrics/query.ts`, `src/metrics/query.test.ts`, `src/metrics/compute.ts`, `src/metrics/compute.test.ts`, `src/metrics/refresh.ts`, `src/metrics/refresh.test.ts`

**Interfaces:**
- Consumes: `OwoxLike` (Task 5), `runPool` (Task 5), stats and dates (Tasks 2, 4), types.
- Produces:

```ts
// query.ts
export function valueKey(m: Measure): string;            // fn null → field; else `${field.replace(/\./g, '_')} | ${TOKEN[fn]}`
export function totalOptions(m: Measure, dateField: string | null, w: DateWindow | null): Record<string, unknown>;
export function dailyOptions(m: Measure, dateField: string, w: DateWindow): Record<string, unknown>;
export function toNumber(v: unknown): number | null;     // numbers, numeric strings; else null; never NaN
export async function readRows(owox: OwoxLike, martId: string, options: Record<string, unknown>): Promise<Record<string, unknown>[]>;
export async function queryTotal(owox: OwoxLike, martId: string, m: Measure, dateField: string | null, w: DateWindow | null): Promise<number | null>;
export async function queryDaily(owox: OwoxLike, martId: string, m: Measure, dateField: string, w: DateWindow): Promise<Map<Day, number>>;

// compute.ts
export interface ComputeOut { result: MetricResult; spark: SeriesPack | null }
export async function computeMetric(args: { owox: OwoxLike; metric: MetricDef; spec: RangeSpec; comparisonOn: boolean; thresholdPct: number; withSpark: boolean }): Promise<ComputeOut>;

// refresh.ts
export async function refreshCanvas(args: { owox: OwoxLike; model: Model; spec: RangeSpec; comparisonOn: boolean; thresholdPct: number; onProgress?: (done: number, total: number) => void }): Promise<CacheDoc>;
export const cacheKey: (preset: Preset, comparisonOn: boolean) => string; // `${preset}:${comparisonOn ? 'cmp' : 'nocmp'}`
```

`TOKEN = { SUM: 'SUM', AVG: 'AVG', MIN: 'MIN', MAX: 'MAX', COUNT: 'COUNT', COUNT_DISTINCT: 'COUNTUNIQUE' }`.

Date filter for window `w` on `dateField`: `[{ column: dateField, operator: 'gte', value: w.from }, { column: dateField, operator: 'lt', value: addDays(w.to, 1) }]`. This works for DATE and TIMESTAMP columns. The daily `dateTrunc` carries no `timeZone`, because the backend rejects a time zone on DATE and calculated fields.

`totalOptions(m, dateField, w)`:
- `column: [m.field]`
- `aggregation: m.fn ? [{ column: m.field, function: m.fn }] : null`
- `filter`: the date filter when both `dateField` and `w` are set, else null
- `limit: 1`

`dailyOptions(m, dateField, w)`:
- `column: [dateField, m.field]`
- `aggregation` as above
- `dateTrunc: [{ column: dateField, unit: 'DAY' }]` (no `timeZone`: the backend rejects a time zone on DATE and calculated fields)
- `filter`: the date filter
- `sort: [{ column: dateField, direction: 'asc' }]`
- `limit: 1000`

`queryDaily` keys the map by `String(row[dateField]).slice(0, 10)` and skips rows whose value is null.

**`computeMetric` algorithm:**

1. `dateField` null: `fact = queryTotal(…, null, null)`; result has `note: 'no_date_field'`, comparison, forecast, plan and spark null, `trend: 'flat'`, `status` from fact and no plan (neutral).
2. `historyWindow = { from: min(addDays(anchor, −89), comparison?.from ?? range.from, range.from), to: min(range.to, anchor) }`. When `range.from > anchor`, the history window is `{ from: addDays(anchor, −89), to: anchor }`.
3. `daily = queryDaily(historyWindow)`.
4. Fact:
   - `factWindow` null → fact null.
   - flow → `queryTotal(factWindow)`.
   - level → `levelAt(daily, factWindow)`.
5. Comparison (only when `comparisonOn` and `spec.comparison`): flow → `queryTotal(comparison)`; level → `levelAt(daily, comparison)`.
6. Forecast: only when `spec.endsInFuture`. `forecastFor({ daily, anchor, rangeTo: range.to, kind, fact })`. Null result sets `note: 'short_history'`. `forecastApprox = measure.fn === 'COUNT_DISTINCT' || measure.fn === null`.
7. Plan: when `metric.plan`, `planDaily = queryDaily(plan.martId, plan.measure, plan.dateField, { from: addDays(range.from, −1), to: range.to })`; `plan = planForRange(planDaily, range, shape)`.
8. `status = statusOf(forecast ?? fact, plan, thresholdPct)`, `trend = trendOf(daily, factWindow ?? historyWindow)`, `diffPct = diffPct(fact, comparison)`.
9. Spark (only when `withSpark`): the window is `factWindow` when it has 7 or more days, else the 28 days ending at the anchor. `values` is one entry per day, null when missing. `forecastStart` and `forecast` come from the forecast's `future` when there is one.
10. Any thrown error: return a result with every number null, `status: 'neutral'`, `trend: 'flat'`, `note: null`, `error: describeError(e)`, spark null.

The three or four queries of one metric run in sequence; `refreshCanvas` runs metrics through `runPool(…, 6)` so the request cap holds.

`refreshCanvas` computes every metric of every class (key metric with `withSpark: true`), calls `onProgress` after each, and returns `{ modelHash: model.inputHash, anchor: spec.anchor, refreshedAt: new Date().toISOString(), preset: spec.preset, comparison: comparisonOn, cards }`. A metric shared by two classes is computed once.

- [ ] **Step 1: Write the failing tests**

`src/metrics/query.test.ts`:

```ts
import { dailyOptions, toNumber, totalOptions, valueKey } from './query';

test('value keys follow the http-data labels', () => {
  expect(valueKey({ field: 'revenue', fn: 'SUM' })).toBe('revenue | SUM');
  expect(valueKey({ field: 'id', fn: 'COUNT_DISTINCT' })).toBe('id | COUNTUNIQUE');
  expect(valueKey({ field: 'metrics.cost', fn: 'AVG' })).toBe('metrics_cost | AVG');
  expect(valueKey({ field: 'aov', fn: null })).toBe('aov');
});

test('options', () => {
  expect(totalOptions({ field: 'revenue', fn: 'SUM' }, 'date', { from: '2026-10-01', to: '2026-10-23' })).toEqual({
    column: ['revenue'], aggregation: [{ column: 'revenue', function: 'SUM' }],
    filter: [{ column: 'date', operator: 'gte', value: '2026-10-01' }, { column: 'date', operator: 'lt', value: '2026-10-24' }], limit: 1,
  });
  expect(dailyOptions({ field: 'aov', fn: null }, 'date', { from: '2026-10-01', to: '2026-10-02' })).toMatchObject({
    column: ['date', 'aov'], aggregation: null, dateTrunc: [{ column: 'date', unit: 'DAY' }],
  });
});

test.each([[12, 12], ['1234.50', 1234.5], [null, null], [undefined, null], ['abc', null], [NaN, null], [true, null]] as const)(
  'toNumber(%s)', (v, n) => expect(toNumber(v)).toBe(n),
);
```

`src/metrics/compute.test.ts`:

```ts
import { computeMetric } from './compute';
import { fakeOwox } from '../owox/fake';
import { rangeFor } from '../lib/dates';
import { addDays } from '../lib/dates';
import type { MetricDef } from '../types';

const metric: MetricDef = {
  id: 'm:revenue:SUM', martId: 'm', alias: 'Revenue', measure: { field: 'revenue', fn: 'SUM' }, kind: 'flow',
  dateField: 'date', role: 'critical', source: 'project', isUniqueCount: false,
  plan: { martId: 'p', measure: { field: 'revenue', fn: 'SUM' }, dateField: 'date', shape: 'daily' },
};

// 10/day of fact for every day queried; plan 12/day.
const owox = fakeOwox({
  projectDescription: null, contexts: [], marts: [], details: {}, blendables: {},
  rows: (id, o) => {
    const f = o.filter as { value: string }[];
    const from = f[0]!.value, to = addDays(f[1]!.value, -1);
    const per = id === 'p' ? 12 : 10;
    if (o.dateTrunc) {
      const out = [];
      for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, 'revenue | SUM': String(per) });
      return out;
    }
    let days = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) days++;
    return [{ 'revenue | SUM': per * days }];
  },
});

test('this quarter: fact to date, forecast, plan, near status, spark', async () => {
  const spec = rangeFor('this_quarter', new Date('2026-10-24T10:00:00Z'));
  const { result, spark } = await computeMetric({ owox, metric, spec, comparisonOn: true, thresholdPct: 20, withSpark: true });
  expect(result.fact).toBe(230);
  expect(result.comparison).toBe(230);
  expect(result.diffPct).toBe(0);
  expect(result.forecast).toBeCloseTo(920);
  expect(result.plan).toBe(12 * 92);
  expect(result.status).toBe('near');           // 920 vs 1104 is −16.7%
  expect(result.trend).toBe('flat');
  expect(spark!.values).toHaveLength(23);
  expect(spark!.forecast).toHaveLength(69);
});

test('range after the anchor: no fact, no comparison, forecast only', async () => {
  const spec = rangeFor('this_week', new Date('2026-10-26T08:00:00Z'));
  const { result } = await computeMetric({ owox, metric: { ...metric, plan: null }, spec, comparisonOn: true, thresholdPct: 20, withSpark: false });
  expect(result.fact).toBeNull();
  expect(result.diffPct).toBeNull();
  expect(result.forecast).toBeCloseTo(70);
});

test('a failing query fails only this metric', async () => {
  const broken = { ...owox, dataMarts: { ...owox.dataMarts, traverseData: async () => { throw new Error('TIMEOUT'); } } };
  const { result } = await computeMetric({ owox: broken, metric, spec: rangeFor('last_7d', new Date('2026-10-24T10:00:00Z')), comparisonOn: false, thresholdPct: 20, withSpark: true });
  expect(result.error).toBe('TIMEOUT');
  expect(result.fact).toBeNull();
});
```

`src/metrics/refresh.test.ts`:

```ts
import { cacheKey, refreshCanvas } from './refresh';
import { fakeOwox } from '../owox/fake';
import { rangeFor } from '../lib/dates';
import type { Model } from '../types';

test('refresh fills every card and reports progress', async () => {
  const owox = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {}, rows: () => [{ 'id | COUNTUNIQUE': 5, date: '2026-10-20' }] });
  const model: Model = {
    version: 1, inputHash: 'h1', builtAt: '', builtBy: 'u',
    goal: { classId: 'a', metricId: null, goalMartId: 'a', viaFallback: false },
    classes: [
      { id: 'a', martId: 'a', title: 'A', contexts: [], depth: 0, keyMetricId: 'a:id:COUNT_DISTINCT', metricIds: ['a:id:COUNT_DISTINCT'] },
      { id: 'b', martId: 'b', title: 'B', contexts: [], depth: 1, keyMetricId: null, metricIds: [] },
    ],
    edges: [{ from: 'a', to: 'b' }],
    metrics: [{ id: 'a:id:COUNT_DISTINCT', martId: 'a', alias: 'A', measure: { field: 'id', fn: 'COUNT_DISTINCT' }, kind: 'flow', dateField: 'date', role: 'unique', source: 'schema', isUniqueCount: true, plan: null }],
  };
  const progress: number[] = [];
  const doc = await refreshCanvas({ owox, model, spec: rangeFor('last_7d', new Date('2026-10-24T10:00:00Z')), comparisonOn: true, thresholdPct: 20, onProgress: (d) => progress.push(d) });
  expect(doc.modelHash).toBe('h1');
  expect(doc.anchor).toBe('2026-10-23');
  expect(doc.cards.a!.metrics['a:id:COUNT_DISTINCT']!.fact).toBe(5);
  expect(doc.cards.b).toEqual({ metrics: {}, spark: null });
  expect(progress).toEqual([1]);
  expect(cacheKey('last_7d', true)).toBe('last_7d:cmp');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --maxWorkers=4 src/metrics`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `query.ts`**

```ts
import type { AggFn, DateWindow, Day, Measure } from '../types';
import { addDays } from '../lib/dates';
import type { OwoxLike } from '../owox/sources';

const TOKEN: Record<AggFn, string> = { SUM: 'SUM', AVG: 'AVG', MIN: 'MIN', MAX: 'MAX', COUNT: 'COUNT', COUNT_DISTINCT: 'COUNTUNIQUE' };

export const valueKey = (m: Measure): string => (m.fn ? `${m.field.replace(/\./g, '_')} | ${TOKEN[m.fn]}` : m.field);

const dateFilter = (dateField: string, w: DateWindow) => [
  { column: dateField, operator: 'gte', value: w.from },
  { column: dateField, operator: 'lt', value: addDays(w.to, 1) },
];
const aggregation = (m: Measure) => (m.fn ? [{ column: m.field, function: m.fn }] : null);

export const totalOptions = (m: Measure, dateField: string | null, w: DateWindow | null) => ({
  column: [m.field],
  aggregation: aggregation(m),
  filter: dateField && w ? dateFilter(dateField, w) : null,
  limit: 1,
});

export const dailyOptions = (m: Measure, dateField: string, w: DateWindow) => ({
  column: [dateField, m.field],
  aggregation: aggregation(m),
  dateTrunc: [{ column: dateField, unit: 'DAY' }], // no timeZone: the backend rejects it on DATE and calculated fields
  filter: dateFilter(dateField, w),
  sort: [{ column: dateField, direction: 'asc' }],
  limit: 1000,
});

export function toNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function readRows(owox: OwoxLike, martId: string, options: Record<string, unknown>) {
  const t = await owox.dataMarts.traverseData(martId, options);
  const rows: Record<string, unknown>[] = [];
  for await (const chunk of t.rowChunks()) rows.push(...chunk);
  return rows;
}

export async function queryTotal(owox: OwoxLike, martId: string, m: Measure, dateField: string | null, w: DateWindow | null) {
  const rows = await readRows(owox, martId, totalOptions(m, dateField, w));
  return toNumber(rows[0]?.[valueKey(m)]);
}

export async function queryDaily(owox: OwoxLike, martId: string, m: Measure, dateField: string, w: DateWindow) {
  const out = new Map<Day, number>();
  for (const row of await readRows(owox, martId, dailyOptions(m, dateField, w))) {
    const v = toNumber(row[valueKey(m)]);
    const d = row[dateField];
    if (v !== null && d != null) out.set(String(d).slice(0, 10), v);
  }
  return out;
}
```

- [ ] **Step 4: Implement `compute.ts` and `refresh.ts`**

Follow the algorithm above. Import `describeError` from `../lib/errors`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --maxWorkers=4 src/metrics`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/metrics
git commit -m "feat(metrics): fact, comparison, plan, forecast and canvas refresh"
```

---

### Task 9: Collections store (`src/store/collections.ts`)

**Files:**
- Create: `src/store/collections.ts`, `src/store/collections.test.ts`

**Interfaces:**
- Produces:

```ts
export interface CollectionsLike {
  collections<T>(name: string): {
    get(id: string): Promise<{ document: T } | null>;
    put(id: string, doc: T): Promise<unknown>;
  };
}
export function loadModel(ctx: CollectionsLike): Promise<Model | null>;          // collection 'model', id 'current'; null unless version === 1
export function saveModel(ctx: CollectionsLike, m: Model): Promise<void>;
export function loadSettings(ctx: CollectionsLike): Promise<Settings>;            // 'settings'/'project', merged over DEFAULT_SETTINGS
export function saveSettings(ctx: CollectionsLike, s: Settings): Promise<void>;
export function loadCache(ctx: CollectionsLike, key: string): Promise<CacheDoc | null>; // 'cache'/key
export function saveCache(ctx: CollectionsLike, key: string, doc: CacheDoc): Promise<void>;
export function isStale(doc: CacheDoc | null, model: Model, anchor: Day): boolean;  // missing, other anchor, or other modelHash
export function memoryCollections(): CollectionsLike;                               // in-memory, for tests
```

`loadSettings` clamps `thresholdPct` to 1–100 and falls back to defaults for any key of the wrong type.

- [ ] **Step 1: Write the failing tests**

```ts
import { isStale, loadCache, loadModel, loadSettings, memoryCollections, saveCache, saveModel, saveSettings } from './collections';
import { DEFAULT_SETTINGS, type CacheDoc, type Model } from '../types';

const model = { version: 1, inputHash: 'h' } as Model;
const doc = { modelHash: 'h', anchor: '2026-10-23' } as CacheDoc;

test('round trips and defaults', async () => {
  const ctx = memoryCollections();
  expect(await loadModel(ctx)).toBeNull();
  expect(await loadSettings(ctx)).toEqual(DEFAULT_SETTINGS);
  await saveModel(ctx, model);
  await saveSettings(ctx, { ...DEFAULT_SETTINGS, thresholdPct: 500 });
  await saveCache(ctx, 'k', doc);
  expect(await loadModel(ctx)).toEqual(model);
  expect((await loadSettings(ctx)).thresholdPct).toBe(100);
  expect(await loadCache(ctx, 'k')).toEqual(doc);
});

test('staleness', () => {
  expect(isStale(null, model, '2026-10-23')).toBe(true);
  expect(isStale(doc, model, '2026-10-23')).toBe(false);
  expect(isStale(doc, model, '2026-10-24')).toBe(true);
  expect(isStale(doc, { ...model, inputHash: 'x' }, '2026-10-23')).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure, implement, run to pass**

Run: `npx vitest run --maxWorkers=4 src/store`
Expected: first FAIL (module not found), then PASS after implementing.

- [ ] **Step 3: Commit**

```bash
git add src/store
git commit -m "feat(store): model, cache and settings documents in collections"
```

---

### Task 10: Card, badge and sparkline (`src/ui/Card.tsx`, `Badge.tsx`, `Sparkline.tsx`)

**Files:**
- Create: `src/ui/Sparkline.tsx`, `src/ui/Badge.tsx`, `src/ui/Card.tsx`, `src/ui/Card.test.tsx`
- Modify: `src/styles.css` (append the card rules)

**Interfaces:**
- Consumes: `compact`, `formatPct`, `metricLabel` (Task 4); types.
- Produces:

```tsx
export function Sparkline(props: { spark: SeriesPack; trend: Trend; width?: number; height?: number }): JSX.Element; // default 240 x 40
export function Badge(props: { metric: MetricDef; result: MetricResult | undefined }): JSX.Element;
export function Card(props: {
  cls: ClassNode;
  metrics: MetricDef[];               // in cls.metricIds order
  cache: CardCache | undefined;
  comparisonOn: boolean;
  refreshing: boolean;
  onRetry: () => void;
}): JSX.Element;
```

**Card markup** (`data-status` drives the border colour):

```
<article class="gy-card" data-class-id={id} data-status={status|error|empty}>
  <header class="label">{cls.title}</header>
  <div class="gy-card-value">
    <span class="num gy-big">{compact(fact ?? forecast)}</span>
    {comparisonOn && diffPct !== null && <span class="num gy-diff" data-sign>{formatPct(diffPct)}</span>}
  </div>
  <div class="gy-card-label">{metricLabel(alias, cls.title, isUniqueCount)}</div>
  {spark && <Sparkline …/>}
  {badges.length > 0 && <div class="gy-badges">{badges}</div>}
  <footer class="gy-card-foot num">
    plan {compact(plan)} · forecast {forecastApprox ? '≈' : ''}{compact(forecast)}   // only the parts that are not null
    {note === 'short_history' && 'Not enough history to forecast'}
    {note === 'no_date_field' && 'All time'}
  </footer>
</article>
```

1. When `fact` is null and `forecast` is set, the big number is the forecast, prefixed with `≈` when approximate.
2. Key metric with `error`: `data-status="error"`, the body is "Couldn't load" plus a `Retry` button calling `onRetry`.
3. No key metric: `data-status="empty"`, the body is "No metric yet" in muted text.
4. Badges: one per metric after the key metric. Badge markup is `<span class="gy-badge" data-status={status}>` containing the compact value in `.num`, then a space and the alias, then a 12px lucide `TrendingUp`, `TrendingDown` or `MoveRight` icon with `aria-label` "trend up", "trend down" or "trend flat". A Unique Count badge uses the class title as its name. A badge whose result has an error shows "—" and status neutral.
5. Sparkline: an SVG polyline for the values (null days break the line into segments) and a dashed polyline for the forecast. Stroke colour is `var(--green)` for an up trend, `var(--red)` for down, `var(--muted)` for flat. The SVG has `role="img"` and `aria-label="trend up|down|flat"`.

CSS to append:

```css
.gy-card { position: relative; width: 280px; padding: 16px 20px; background: var(--card); border: 1px solid var(--blue); }
.gy-card[data-status='above'] { border-color: var(--green); }
.gy-card[data-status='near'] { border-color: var(--orange); }
.gy-card[data-status='below'] { border-color: var(--red); }
.gy-card[data-status='error'], .gy-card[data-status='empty'] { border-color: var(--grey); }
.gy-card-value { display: flex; align-items: baseline; gap: 12px; margin-top: 8px; }
.gy-big { font-size: 24px; font-weight: 700; color: var(--blue); }
.gy-diff { font-size: 12.5px; color: var(--text-2); }
.gy-card-label { color: var(--text-2); font-size: 14px; margin: 2px 0 8px; }
.gy-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.gy-badge { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border-radius: 6px; font-size: 11px; line-height: 1.5; background: var(--nested); color: var(--text-2); }
.gy-badge[data-status='above'] { background: #d9eed7; color: #1a1f2e; }
.gy-badge[data-status='near'] { background: #f8e1ca; color: #1a1f2e; }
.gy-badge[data-status='below'] { background: #f6d4d0; color: #1a1f2e; }
.gy-card-foot { margin-top: 8px; font-size: 11px; color: var(--muted); }
```

The badge fills are the pastel fills from owox.com `/map` (`src/admin/sessions.js`): green `#D9EED7`, orange `#F8E1CA`, red `#F6D4D0`, with dark ink.

- [ ] **Step 1: Write the failing tests `src/ui/Card.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { Card } from './Card';
import type { CardCache, ClassNode, MetricDef, MetricResult } from '../types';

const cls: ClassNode = { id: 'c', martId: 'c', title: 'Customers', contexts: [], depth: 0, keyMetricId: 'arr', metricIds: ['arr', 'uc'] };
const arr: MetricDef = { id: 'arr', martId: 'c', alias: 'ARR', measure: { field: 'arr', fn: 'SUM' }, kind: 'level', dateField: 'date', role: 'critical', source: 'project', isUniqueCount: false, plan: null };
const uc: MetricDef = { id: 'uc', martId: 'c', alias: 'Customers', measure: { field: 'id', fn: 'COUNT_DISTINCT' }, kind: 'flow', dateField: 'date', role: 'unique', source: 'schema', isUniqueCount: true, plan: null };
const res = (over: Partial<MetricResult>): MetricResult => ({ fact: 1_240_000, comparison: 1_000_000, diffPct: 24, plan: 1_300_000, forecast: null, forecastApprox: false, status: 'near', trend: 'up', note: null, error: null, ...over });
const cache = (over: Partial<MetricResult> = {}): CardCache => ({
  metrics: { arr: res(over), uc: res({ fact: 7148, status: 'above', trend: 'down', plan: null }) },
  spark: { start: '2026-10-01', values: [1, 2, null, 4], forecastStart: null, forecast: [] },
});

test('key metric, label, diff, badge order and status', () => {
  const { container } = render(<Card cls={cls} metrics={[arr, uc]} cache={cache()} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('1.24M')).toBeInTheDocument();
  expect(screen.getByText('ARR from Customers')).toBeInTheDocument();
  expect(screen.getByText('+24.0%')).toBeInTheDocument();
  const badge = container.querySelector('.gy-badge')!;
  expect(badge.textContent).toMatch(/^7\.15K Customers/);
  expect(badge.getAttribute('data-status')).toBe('above');
  expect(screen.getByLabelText('trend down')).toBeInTheDocument();
  expect(container.querySelector('.gy-card')!.getAttribute('data-status')).toBe('near');
  expect(container.textContent).not.toMatch(/unique count/i);
});

test('no diff when comparison is off; forecast shown when fact is missing', () => {
  render(<Card cls={cls} metrics={[arr, uc]} cache={cache({ fact: null, forecast: 900, forecastApprox: true })} comparisonOn={false} refreshing={false} onRetry={() => {}} />);
  expect(screen.queryByText('+24.0%')).toBeNull();
  expect(screen.getByText('≈900')).toBeInTheDocument();
});

test('error card offers retry; empty card says no metric', () => {
  const onRetry = vi.fn();
  render(<Card cls={cls} metrics={[arr, uc]} cache={cache({ error: 'TIMEOUT' })} comparisonOn refreshing={false} onRetry={onRetry} />);
  screen.getByRole('button', { name: 'Retry' }).click();
  expect(onRetry).toHaveBeenCalled();
  render(<Card cls={{ ...cls, keyMetricId: null, metricIds: [] }} metrics={[]} cache={undefined} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('No metric yet')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure, implement, run to pass**

Run: `npx vitest run --maxWorkers=4 src/ui/Card.test.tsx`
Expected: first FAIL, then PASS.

- [ ] **Step 3: Commit**

```bash
git add src/ui/Sparkline.tsx src/ui/Badge.tsx src/ui/Card.tsx src/ui/Card.test.tsx src/styles.css
git commit -m "feat(ui): metric card with sparkline, % diff and plan-coloured badges"
```

---

### Task 11: Canvas layout and context filter (`src/ui/layout.ts`, `src/ui/Canvas.tsx`)

**Files:**
- Create: `src/ui/layout.ts`, `src/ui/layout.test.ts`, `src/ui/Canvas.tsx`, `src/ui/Canvas.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `Card` (Task 10), types.
- Produces:

```ts
// layout.ts
export interface Connector { from: string; to: string; dashed: boolean }
export interface Layout { rows: ClassNode[][]; connectors: Connector[] }
/** selected empty means All. */
export function layoutFor(model: Model, selected: ReadonlySet<string>): Layout;
export function contextsOf(model: Model): ContextRef[]; // unique, sorted by name

// Canvas.tsx
export function Canvas(props: {
  model: Model; cache: CacheDoc | null; comparisonOn: boolean; refreshing: boolean; onRetry: () => void;
}): JSX.Element;
```

`layoutFor` rules:

1. Visible classes: all when `selected` is empty, else classes with a context in `selected`, plus the main class (`model.goal.classId`) always.
2. Rows are visible classes grouped by `depth` ascending, re-numbered without gaps, each row sorted by title.
3. Connectors: for each visible class `u`, walk edges from `u` through hidden classes (depth-first, no revisits). Each visible class reached directly gives `{ from: u, to: v, dashed: false }`; reached through at least one hidden class gives `dashed: true`. When the same pair is reachable both ways, keep the solid one. Sort by `from`, then `to`.

`Canvas`:

1. A chip row: `All` then one chip per context from `contextsOf`. Chips are `<button class="gy-chip" aria-pressed>`. Clicking `All` clears the selection. Clicking a context toggles it. Filter state lives in component state.
2. Rows render as flex rows, centred, with a 72px gap between rows and 24px between cards.
3. An absolutely positioned SVG overlay draws each connector as a line from the bottom centre of the `from` card to the top centre of the `to` card. Measure with `getBoundingClientRect` in `useLayoutEffect`, and again on `ResizeObserver` callbacks and when the filter changes. Dashed connectors use `stroke-dasharray="4 4"`. Stroke `var(--border-hover)`. Each line carries `data-from`, `data-to`, `data-dashed`.
4. When `refreshing`, a 2px progress bar (`.gy-progress`) sits above the canvas.
5. Retry calls `onRetry` (the whole refresh reruns).

CSS to append:

```css
.gy-chips { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 8px; margin-bottom: 24px; }
.gy-chip { flex: none; height: 32px; padding: 0 12px; border: 1px solid var(--border); background: transparent; cursor: pointer; font: 400 11px var(--font-num); text-transform: uppercase; color: var(--text-2); }
.gy-chip[aria-pressed='true'] { border-color: var(--blue); color: var(--blue); }
.gy-canvas { position: relative; display: flex; flex-direction: column; gap: 72px; align-items: center; }
.gy-row { display: flex; gap: 24px; flex-wrap: wrap; justify-content: center; }
.gy-links { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
.gy-progress { position: absolute; top: -12px; left: 0; height: 2px; width: 100%; overflow: hidden; background: var(--border-quiet); }
.gy-progress::after { content: ''; position: absolute; inset-block: 0; width: 40%; background: var(--blue); animation: gy-slide 1.1s infinite; }
@keyframes gy-slide { from { left: -40%; } to { left: 100%; } }
```

- [ ] **Step 1: Write the failing tests**

`src/ui/layout.test.ts`:

```ts
import { contextsOf, layoutFor } from './layout';
import type { ClassNode, Model } from '../types';

const c = (id: string, depth: number, ctx: string[] = []): ClassNode => ({ id, martId: id, title: id.toUpperCase(), depth, keyMetricId: null, metricIds: [], contexts: ctx.map((x) => ({ id: x, name: x })) });
const model = {
  goal: { classId: 'm' },
  classes: [c('m', 0), c('a', 1, ['growth']), c('b', 2, ['sales']), c('z', 1, ['sales'])],
  edges: [{ from: 'm', to: 'a' }, { from: 'a', to: 'b' }, { from: 'm', to: 'z' }],
} as unknown as Model;

test('all classes by depth', () => {
  const l = layoutFor(model, new Set());
  expect(l.rows.map((r) => r.map((x) => x.id))).toEqual([['m'], ['a', 'z'], ['b']]);
  expect(l.connectors).toEqual([
    { from: 'a', to: 'b', dashed: false }, { from: 'm', to: 'a', dashed: false }, { from: 'm', to: 'z', dashed: false },
  ]);
});

test('filter keeps main and bridges hidden classes with dashed connectors', () => {
  const l = layoutFor(model, new Set(['sales']));
  expect(l.rows.map((r) => r.map((x) => x.id))).toEqual([['m'], ['z'], ['b']]);
  expect(l.connectors).toEqual([{ from: 'm', to: 'b', dashed: true }, { from: 'm', to: 'z', dashed: false }]);
});

test('contexts are unique and sorted', () => {
  expect(contextsOf(model).map((x) => x.id)).toEqual(['growth', 'sales']);
});
```

`src/ui/Canvas.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { Canvas } from './Canvas';
import type { Model } from '../types';

const model = {
  goal: { classId: 'm' },
  classes: [
    { id: 'm', martId: 'm', title: 'Main', depth: 0, keyMetricId: null, metricIds: [], contexts: [] },
    { id: 'a', martId: 'a', title: 'Alpha', depth: 1, keyMetricId: null, metricIds: [], contexts: [{ id: 'g', name: 'Growth' }] },
  ],
  edges: [{ from: 'm', to: 'a' }],
  metrics: [],
} as unknown as Model;

test('chips filter classes, main stays', () => {
  render(<Canvas model={model} cache={null} comparisonOn refreshing={false} onRetry={() => {}} />);
  expect(screen.getByText('Alpha')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Growth' }));
  expect(screen.getByRole('button', { name: 'Growth' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Main')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
});
```

happy-dom has `ResizeObserver`; if not, guard with `typeof ResizeObserver !== 'undefined'`.

- [ ] **Step 2: Run to verify failure, implement, run to pass**

Run: `npx vitest run --maxWorkers=4 src/ui/layout.test.ts src/ui/Canvas.test.tsx`
Expected: first FAIL, then PASS.

- [ ] **Step 3: Commit**

```bash
git add src/ui/layout.ts src/ui/layout.test.ts src/ui/Canvas.tsx src/ui/Canvas.test.tsx src/styles.css
git commit -m "feat(ui): canvas rows, context chips and connectors"
```

---

### Task 12: App shell, header, blocked screens and settings (`src/App.tsx`, `src/ui/Header.tsx`, `src/ui/Blocked.tsx`, `src/ui/SettingsPage.tsx`)

**Files:**
- Rewrite: `src/App.tsx`, `src/App.test.tsx`
- Create: `src/ui/Header.tsx`, `src/ui/Blocked.tsx`, `src/ui/Blocked.test.tsx`, `src/ui/SettingsPage.tsx`, `src/ui/SettingsPage.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: everything above. `App` takes `{ ctx: PluginContext }` and also accepts an optional `deps` prop for tests:

```ts
export interface AppDeps {
  owox: OwoxLike;
  store: CollectionsLike;
  generate: Generate | null;   // aiGenerate(ctx.credentials.ai, ctx.signal) when ctx.credentials.ai exists, else null
  userId: string;
  now: () => Date;
}
export function App(props: { ctx: PluginContext; deps?: AppDeps }): JSX.Element;
```

`App` builds `deps` from `ctx` when `deps` is absent: `owox: ctx.owox as unknown as OwoxLike`, `store: ctx`, `generate: ctx.credentials.ai ? aiGenerate(ctx.credentials.ai, ctx.signal) : null`, `userId: ctx.userId`, `now: () => new Date()`.

**State machine:**

| State | Shown | Next |
|---|---|---|
| `loading` | "Loading…" | Load settings and model. No model → `intro`. Model → `ready` |
| `intro` | Title, one paragraph ("Gyroscope reads your project description, finds the goal and draws the classes that drive it."), `Build model` button (disabled with the text "Ask a project admin to map an AI model" when `generate` is null) | Build → `building` |
| `building` | "Reading descriptions and schemas…" | `buildModel` ok → save model → `ready`; blocked → `blocked` |
| `blocked` | `<Blocked blocked={…} onRetry={build} />` | Retry → `building` |
| `ready` | `<Header/>`, the out-of-date banner when needed, `<Canvas/>` | Settings → `settings` |
| `settings` | `<SettingsPage/>` | Save or Back → `ready` |

**In `ready`:**

1. `preset` and `comparisonOn` start from settings and live in component state.
2. On entering `ready` and on every change of `preset` or `comparisonOn`: `spec = rangeFor(preset, now())`; load `cacheKey(preset, comparisonOn)`. Show it at once when present. When `isStale(doc, model, spec.anchor)`, run `refreshCanvas`, show progress, then save and show the new doc. Ignore results from a refresh superseded by a newer one (keep a counter in a ref).
3. `Refresh` forces `refreshCanvas`.
4. Out-of-date check: once per entry into `ready`, `fetchInputs` then `inputHash(inputs) !== model.inputHash` shows the banner "Descriptions or schemas changed since this model was built." with a `Rebuild model` button. A failed check shows nothing.
5. `Rebuild model` runs the build. On success it replaces the model and refreshes; on blocked it shows the blocked screen.

**Header** (`src/ui/Header.tsx`): left is "GYROSCOPE" as `.label` and, under it, the main class title in 24px. Right holds, in order:

1. A `<select aria-label="Date range">` with `<optgroup>`s from `PRESET_GROUPS` and option text from `PRESET_LABELS`.
2. A checkbox labelled "Compare with previous period".
3. Buttons `Refresh`, `Rebuild model` and `Settings`.
4. "Updated <relative time>" from `cache.refreshedAt` in muted text, or "Not loaded yet".

**Blocked** (`src/ui/Blocked.tsx`): a `.gy-blocked` panel with:

1. The heading "Goal can't be tracked" for the `NO_GOAL`, `GOAL_*` codes, "AI model not configured" for `AI_NOT_CONFIGURED`, and "The model doesn't match your Data Marts" for `AI_INVALID`.
2. `detail` as a paragraph, and `mismatches` as a numbered list when non-empty.
3. A numbered "How to fix" list per code:

| Code | Steps |
|---|---|
| `NO_GOAL`, `GOAL_PLACEHOLDER` | 1. Open Project settings in OWOX Data Marts and edit the project description. 2. Add a Metrics table with a "Critical number" row (snippet below). 3. Link the Fact cell to the Data Mart field that measures the goal: open the Data Mart, select the field, copy the link. 4. Come back and click Retry. |
| `GOAL_FIELD_NOT_FOUND` | 1. Open the Data Mart linked in the Critical number row. 2. Check the field name in the link's `field=` parameter against the schema. 3. Fix the link in the project description, then Retry. |
| `GOAL_NO_PRIMARY_KEY` | 1. Open the Data Mart linked in the Critical number row. 2. Mark its primary key fields in the schema. 3. Retry. |
| `GOAL_NOT_CONNECTED` | 1. Ask a project admin for access to the goal's Data Mart, or 2. add a calculated field to a Data Mart you can see that references the goal's Data Mart, then 3. Retry. |
| `AI_NOT_CONFIGURED` | 1. Ask a project admin to open Plugins, select Gyroscope and map an AI Credential. 2. Retry. |
| `AI_INVALID` | 1. Make the metrics tables name exact fields through Data Mart links. 2. Make sure each linked Data Mart has a date field. 3. Retry. |

4. For `NO_GOAL` and `GOAL_PLACEHOLDER`, a `<pre class="gy-snippet">` with this text and a `Copy` button (`navigator.clipboard.writeText`, failure ignored):

```
## Metrics
| Role | Metric | Owner | Plan | Fact |
|---|---|---|---|---|
| Critical number | ARR | <owner> | [Plan · ARR](https://app.owox.com/ui/<project-id>/data-marts/<plan-data-mart-id>/data-setup?field=<plan_field>) | [ARR](https://app.owox.com/ui/<project-id>/data-marts/<fact-data-mart-id>/data-setup?field=<fact_field>) |
```

Replace `<project-id>` with the real `ctx.projectId`, passed in as a `projectId` prop.

5. A `Retry` button (primary).

**SettingsPage** (`src/ui/SettingsPage.tsx`): props `{ settings: Settings; onSave(s: Settings): void; onBack(): void }`. It has:

1. A number input "Red when below plan by more than (%)" (min 1, max 100).
2. The default date range select.
3. The checkbox "Compare with previous period by default".
4. A disabled section "Properties — coming later".
5. `Save` and `Back` buttons. Use buttons with click handlers, not a `<form>` submit.

CSS to append:

```css
.gy-header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; align-items: flex-end; margin-bottom: 24px; }
.gy-header-tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.gy-header select { height: 36px; background: var(--card); color: var(--text); border: 1px solid var(--border); padding: 0 8px; }
.gy-banner { border: 1px solid var(--orange); padding: 12px 16px; margin-bottom: 24px; display: flex; gap: 16px; align-items: center; }
.gy-blocked { max-width: 720px; margin: 48px auto; padding: 42px 56px 21px; background: var(--card); border: 1px solid var(--red); }
.gy-blocked ol { padding-left: 20px; }
.gy-snippet { background: var(--nested); padding: 12px; overflow-x: auto; font: 12px/1.5 var(--font-num); }
```

- [ ] **Step 1: Write the failing tests**

`src/ui/Blocked.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { Blocked } from './Blocked';

test('placeholder goal shows reason, steps and snippet with the project id', () => {
  render(<Blocked blocked={{ code: 'GOAL_PLACEHOLDER', detail: 'The ARR link is a placeholder.', mismatches: [] }} projectId="p42" onRetry={() => {}} />);
  expect(screen.getByRole('heading', { name: "Goal can't be tracked" })).toBeInTheDocument();
  expect(screen.getByText('The ARR link is a placeholder.')).toBeInTheDocument();
  expect(screen.getByText(/Critical number \| ARR/)).toHaveTextContent('/ui/p42/data-marts/');
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});

test('AI_INVALID lists mismatches', () => {
  render(<Blocked blocked={{ code: 'AI_INVALID', detail: 'x', mismatches: ['ARR → field "a" not found in M'] }} projectId="p" onRetry={() => {}} />);
  expect(screen.getByText('ARR → field "a" not found in M')).toBeInTheDocument();
});
```

`src/ui/SettingsPage.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';
import { DEFAULT_SETTINGS } from '../types';

test('saves edited threshold', () => {
  const onSave = vi.fn();
  render(<SettingsPage settings={DEFAULT_SETTINGS} onSave={onSave} onBack={() => {}} />);
  fireEvent.change(screen.getByLabelText(/Red when below plan/), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, thresholdPct: 15 });
});
```

`src/App.test.tsx` (replace the smoke test):

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { App, type AppDeps } from './App';
import { fakeOwox } from './owox/fake';
import { memoryCollections } from './store/collections';

const deps = (generate: AppDeps['generate']): AppDeps => ({
  owox: fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {} }),
  store: memoryCollections(),
  generate,
  userId: 'u1',
  now: () => new Date('2026-10-24T10:00:00Z'),
});

test('first open shows intro; build with no goal shows the blocked screen', async () => {
  render(<App ctx={{ projectId: 'p1' } as never} deps={deps(async () => ({ goal: { status: 'missing', metricRef: null, note: '' }, metrics: [] }))} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Build model' }));
  expect(await screen.findByRole('heading', { name: "Goal can't be tracked" })).toBeInTheDocument();
});

test('without AI the build button is disabled with a reason', async () => {
  render(<App ctx={{ projectId: 'p1' } as never} deps={deps(null)} />);
  expect(await screen.findByRole('button', { name: 'Build model' })).toBeDisabled();
  expect(screen.getByText('Ask a project admin to map an AI model')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --maxWorkers=4 src/App.test.tsx src/ui/Blocked.test.tsx src/ui/SettingsPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `Blocked.tsx`, `SettingsPage.tsx`, `Header.tsx`, then `App.tsx`**

Follow the specifications above. `App` passes `ctx.projectId` to `Blocked`. It calls `ctx.ui?.setRoute?.('/settings')` when opening settings and `'/'` when leaving, guarded with optional chaining because tests pass a partial `ctx`.

- [ ] **Step 4: Run the whole suite, typecheck and build**

Run: `npm run typecheck && npx vitest run --maxWorkers=4 && npx vite build`
Expected: all pass; `dist/index.html` exists.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat(ui): app states, header, blocked screens and settings page"
```

---

### Task 13: Docs and release notes (`README.md`)

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

The README has these sections, in plain sentences:

1. What Gyroscope does: one paragraph from spec section 1.
2. Requirements in OWOX: a Critical number row in the project description's Metrics table linking to a Data Mart field, an AI Credential mapped at install, and calculated fields that reference other Data Marts to draw connections.
3. Develop: `npm install`, `npm test`, `npm run typecheck`, `npm run build`. Local preview is not supported by the plugin platform; test as an installed plugin.
4. Release: push to `main` (GitHub Pages deploys `dist/`), check with `owox-ctl plugins check OWOX/gyroscope --ref main`, create a release `gh release create v0.1.0 --target main --generate-notes`, then publish in OWOX under Plugins → Publish Plugin with "Only me" for testing.
5. How it works: a numbered list mapping to spec sections 5 to 10, with links to the spec file.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README for Gyroscope"
```
