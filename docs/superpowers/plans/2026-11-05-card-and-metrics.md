# Card and Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix ratio kinds (#6), hide metrics OWOX can't compute, add a per-metric number format, and rework the card's secondary metrics and icons.

**Spec:** these user requests, from 2026-11-05, are the binding authority:
1. Apply the fix suggested in OWOX/gyroscope#6. A metric-level calculated field is always `flow`.
2. The unique count of an INTEGER primary key can't be computed through the plugin data endpoint: number fields allow only SUM, AVG, MIN and MAX. Hide every metric that can't be calculated, until OWOX/owox-data-marts#1829 ships. Remove the COUNT fallback, which can never work.
3. While the model is built, define a format for each metric: `currency`, `percent` or the default (`number`). Format values with it, so 0.0402 reads 4.0%.
4. Clicking "Show +N more" shows the full list below, all visible at once, without changing the card's height.
5. Clicking a secondary metric puts it in the card's header: its value, label and diff. The previous main metric moves into the secondary list.
6. The (i) tooltip text uses the same font size as the context labels.
7. A link to the Data Mart page, as an external-link icon.
8. A data validation (data quality) icon.
9. The (i), external-link and data-quality icons show only while the card is hovered (or has focus inside).

## Global Constraints

- Run tests with `npx vitest run --maxWorkers=4` only, and keep `npx tsc --noEmit -p .` clean.
- Use only the CSS tokens in `src/styles.css`, in light and dark. Keyboard focus must be visible (`outline: none; box-shadow: 0 0 0 2px var(--primary)`), and every control needs an accessible name.
- A missing field, mart or API refusal degrades to a hidden element or `—`, never a crash.
- Commit after each task with a message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Ratio kind and hidden uncomputable metrics

**Files:** `src/model/validate.ts`, `src/model/upgrade.ts`, `src/metrics/query.ts`, `src/metrics/compute.ts`, `src/model/shown.ts` or `src/model/health.ts` (whichever already decides what the canvas shows), tests.

1. `validate.ts`: when the fact measure has `fn === null` (a metric-level calculated field, from `measureFor`), set `kind: 'flow'` whatever the AI returned. A stored column keeps the AI's `kind`.
2. `upgrade.ts`: when a model loads, a metric with `measure.fn === null` gets `kind: 'flow'` (both v1 and v2 paths), so saved models are fixed without a rebuild.
3. A field "allows" an aggregation when:
   1. it is calculated at metric level and the measure's `fn` is null, or
   2. its `allowedAggregations` array is present and contains the function, or
   3. `allowedAggregations` is absent and the OWOX default for its type contains it: number types (INTEGER, INT64, FLOAT, FLOAT64, NUMERIC, BIGNUMERIC, DECIMAL, and the like) allow SUM, AVG, MIN, MAX; STRING allows COUNT, COUNT_DISTINCT; BOOLEAN allows COUNT, COUNT_DISTINCT; date and time types allow MIN, MAX.
   Put this in one exported helper (e.g. `allowsAggregation(field, fn)` in `src/model/validate.ts` or a new small module) and use it everywhere below.
4. `uniqueCountMetric` returns null when the key field doesn't allow COUNT_DISTINCT.
5. A metric already in a saved model whose measure isn't allowed by the live field (from the details the app already fetches for health) is hidden from the canvas, the same way as `shown: false`, but keeps its stored `shown` flag. The Ontology tab lists it with a warning "OWOX can't compute this aggregation for this field" instead of hiding it there. A class whose key metric is hidden uses its next shown metric as key. No query is ever sent for a hidden metric.
6. Remove the COUNT fallback from `src/metrics/query.ts` (`noDistinct`, `refusesDistinct`, `readMeasure`, the `uniqueKey` parameters) and its callers in `compute.ts`. Keep a short comment pointing to OWOX/owox-data-marts#1829 where `uniqueCountMetric` checks the key.
7. Tests:
   1. A calculated ratio with `kind: 'level'` from the AI and a `level` plan comes out `flow`, plan shape still `level`.
   2. A stored column the AI marks `level` stays `level`.
   3. A saved model holding a `level` ratio with `fn: null` loads as `flow`.
   4. An INTEGER primary key gives no unique-count metric; a STRING key does.
   5. A saved model with a COUNT_DISTINCT unique count on an INTEGER key: the canvas doesn't show it and sends no query for it; the Ontology tab shows the warning.

### Task 2: Metric format

**Files:** `src/types.ts`, `src/model/interpret.ts` (schema and prompt), `src/model/validate.ts`, `src/model/upgrade.ts`, `src/model/diff.ts`, `src/ui/OntologyTab.tsx`, the value formatter (find it in `src/lib` or `src/ui/Card.tsx`), tests.

1. `MetricDef` gains `format: 'number' | 'percent' | 'currency'` and `currency: string | null` (ISO 4217 code, only for `currency`).
2. The AI output for each metric gains `format` and `currency`. The prompt says: `percent` for rates, shares and ratios stored as fractions (0.04 = 4%); `currency` for money, with the currency code when the description or field names one, else null; otherwise `number`. Parse leniently: a missing or unknown value becomes `number`, a bad currency code becomes null.
3. The unique-count metric is `number`. `upgradeModel` gives every metric without a valid format `format: 'number', currency: null`.
4. Formatting, applied to fact, comparison, plan, forecast, the secondary badges, and the absolute comparison chip:
   1. `percent`: value × 100 with one decimal and `%` (0.0402 → `4.0%`). An absolute difference between two percents shows as percentage points (`+1.2 pp`).
   2. `currency`: the existing compact number formatting with the currency symbol from `Intl.NumberFormat` when `currency` is set, else the number alone.
   3. `number`: unchanged.
5. The Ontology tab shows a Format select (Number, Percent, Currency) per metric, and a currency code input when Currency is chosen. Both are part of the draft and saved with the model. `diffModels` reports a format change as a `metric_changed` field `format`.
6. Tests: the parser defaults; upgrade defaults; `4.0%`; `+1.2 pp`; a currency value with a symbol; the Ontology select saves; a rebuild proposal shows a format change.

### Task 3: Card secondary metrics and icons

**Files:** `src/ui/Card.tsx`, `src/styles.css`, `src/App.tsx` (pass `onOpen` and the project id), tests.

1. "Show +N more" opens the full list of secondary metrics as a panel directly below the visible badges, absolutely positioned over whatever is under the card, so the card keeps its height and every metric is visible at once. "Show less", Escape or a click outside closes it. Remove the old in-place scroll behaviour.
2. Clicking a secondary metric (a button with an accessible name like "Show Conversion rate") makes it the card's main metric: the header label, the value, the comparison chip and diff, the plan status colour, and the sparkline all follow it. The previous main metric goes into the secondary list in its place. The choice is per card and lasts for the session only (React state, not saved). The class's stored key metric doesn't change.
3. The (i) tooltip text uses the font size of the context labels (the context chips' CSS class); find that size in `styles.css` and use the same token or value.
4. An external-link icon button (lucide `ExternalLink`, name "Open <mart title> in OWOX") calls `onOpen('/ui/<projectId>/data-marts/<martId>/overview')`, the same `ctx.ui.navigate` wiring the Blocked screen uses. No icon when `onOpen` is missing.
5. The (i), external-link and data-quality icons (Task 4) sit in one group in the card's top-right corner. The group is visible only while the card is hovered or has focus inside (`:hover` / `:focus-within`), so keyboard users still reach them; on devices without hover (`@media (hover: none)`) it is always visible.
6. Tests: the panel lists every secondary metric and the card's height style doesn't change; clicking a secondary swaps label and value and puts the old main in the list; the external link calls `onOpen` with the overview path; the icon group has the hover class (style behaviour is checked by class, not by computed style).

### Task 4: Data quality icon

**Files:** `src/owox/sources.ts` (add a POST helper to `OwoxLike` if needed, e.g. `postJson`), a new `src/owox/quality.ts`, `src/App.tsx`, `src/ui/Card.tsx`, `src/owox/fake.ts`, tests.

1. Once per canvas load, call `POST /api/data-marts/data-quality/summaries` with `{ dataMartIds: [...] }` for the classes on the canvas. The response is `{ items: { dataMartId, summary: { state, enabledChecks, passedChecks, failedChecks, errorChecks, warningFindings, errorFindings, highestSeverity, lastRunAt } }[] }`. States: NEVER_RUN, QUEUED, RUNNING, PASSED, ISSUES, EXECUTION_FAILED, RESTRICTED, CANCELLED, ALL_DISABLED. Severities: notice, warning, error. Check `ctx.owox` in `node_modules/@owox/plugin-sdk` for how to send a POST with a body.
2. Never cache it. A refused or failed call shows no icons and no error.
3. In the card's icon group, a lucide shield icon button:
   1. PASSED: `ShieldCheck` in the success (on-plan) colour, name "Data quality: all N checks passed".
   2. ISSUES: `ShieldAlert`, in the red token when `highestSeverity` is error, else the orange token; name "Data quality: N issues".
   3. EXECUTION_FAILED: `ShieldX` in the red token, name "Data quality checks failed to run".
   4. Any other state: no icon.
   Clicking it calls `onOpen('/ui/<projectId>/data-marts/<martId>/quality')`.
4. Tests: each state maps to the right icon and name; a failed call shows nothing; the click path.
