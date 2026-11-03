# Date Range Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace the toolbar's date-range select and comparison checkbox with one dropdown control: presets on the left, a range calendar on the right, and a comparison section (checkbox, comparison presets, second calendar) below it. Custom dates are allowed for both the range and the comparison. The per-card comparison dropdown goes away.

**Architecture:** The range and comparison become small tagged unions (`RangeChoice`, `CompareChoice`). One pure function, `resolveRange`, turns them into the existing `RangeSpec`, which `computeMetric` and `refreshCanvas` already consume. A comparison shorter or longer than the range is matched day for day, as before: both windows are cut to the shorter length from their own start, and the card's main value is recounted over the cut window.

**Tech Stack:** React 19, TypeScript, Vite, Vitest 4 + happy-dom + Testing Library, lucide-react. No new dependencies; the calendar is written by hand.

**Spec:** the user's request in conversation (2026-11-03), reproduced here as the binding authority:
1. All date range settings live inside one dropdown control.
2. Closed, it reads like "This quarter vs previous" (just "This quarter" when comparison is off).
3. Open: presets on the left, a calendar on the right. Custom dates can be picked on the calendar.
4. A checkbox turns comparison on. When it is on, a comparison calendar shows below the main one.
5. Comparison offers relevant presets with the same number of days, plus "Custom" to pick any dates.
6. The per-card period dropdown is removed: one comparison for the whole canvas.

## Global Constraints

- Run tests with `npx vitest run --maxWorkers=4` (never unbounded workers). Typecheck with `npx tsc --noEmit -p .`.
- Days are `Day` strings `'YYYY-MM-DD'` in UTC (see `src/lib/dates.ts`). Weeks start on Monday, matching `periodOf`.
- Style with the existing tokens in `src/styles.css` (`--card`, `--border`, `--muted`, `--muted-foreground`, `--primary`, `--primary-foreground`, `--foreground`). Light and dark (`:root.dark`) must both work. Visible keyboard focus, accessible names.
- Match surrounding code: terse comments only where a reader needs the why, no new dependencies.
- Commit after each task with a message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A custom range whose end is in the future: fact is clipped to yesterday, the forecast runs to the range end (as presets do today).
2. A custom range that starts after yesterday: no fact, no comparison, no crash.
3. A custom comparison of a different length than the range: both cut to the shorter length; the card's main number is the recounted one and the diff matches it.
4. A comparison window that would reach past yesterday (e.g. "Previous period" for a range that ends today): never queries future days.
5. Cache docs for custom choices are not persisted (they would pile up per member); presets still persist per key.

---

### Task 1: Range and comparison model

**Files:**
- Modify: `src/types.ts`, `src/lib/dates.ts`, `src/metrics/compute.ts`, `src/metrics/refresh.ts`, `src/lib/format.ts` (only if a label helper fits there better)
- Test: `src/lib/dates.test.ts`, `src/metrics/compute.test.ts`, `src/metrics/refresh.test.ts` (whichever exist; add cases)

**Produces (exact names later tasks use):**

```ts
// src/types.ts
export type RangeChoice = { kind: 'preset'; preset: Preset } | { kind: 'custom'; window: DateWindow };
export type ComparePreset = 'previous_period' | 'preceding_days' | 'year_before';
export type CompareChoice = { kind: 'off' } | { kind: 'preset'; preset: ComparePreset } | { kind: 'custom'; window: DateWindow };

// RangeSpec changes:
//  - `preset: Preset` is replaced by `label: string` (the closed-control text for the range, e.g. 'This quarter' or 'Oct 1 – Nov 2, 2026')
//  - add `compareFact: DateWindow | null`  — the fact window cut to the comparison's length; null when comparison is off or no cut is needed
//  - `comparison` keeps its meaning: the comparison window actually queried (already matched), or null when off / not started

// src/lib/dates.ts
export function resolveRange(range: RangeChoice, compare: CompareChoice, now: Date): RangeSpec;
/** The comparison presets that make sense for this range, each with its window, all the same length as the fact window. */
export function compareOptions(range: RangeChoice, now: Date): { preset: ComparePreset; label: string; window: DateWindow }[];
export function rangeLabel(range: RangeChoice): string;          // 'This quarter' | 'Oct 1 – Nov 2, 2026'
export function compareLabel(range: RangeChoice, compare: CompareChoice): string | null; // after "vs" on cards: e.g. 'Last Quarter', 'Previous 33 Days', 'Same Period Last Year', 'Jul 1 – Aug 2, 2026'; null when off
export function controlLabel(range: RangeChoice, compare: CompareChoice): string; // closed control: 'This quarter vs previous', 'This quarter vs last year', 'This quarter vs Jul 1 – Aug 2, 2026', or 'This quarter'

// src/metrics/refresh.ts
export const cacheKey: (range: RangeChoice, compare: CompareChoice) => string;
export const persistable: (range: RangeChoice, compare: CompareChoice) => boolean; // false when either is custom
```

Behaviour:
1. `resolveRange` with a preset range and `previous_period` gives exactly today's `rangeFor(preset, now)` windows (keep `rangeFor` as the preset path; `resolveRange` builds on it).
2. Custom range: `range = window`, `anchor = anchorFor(now)`, `factWindow` = window clipped to the anchor (null if it starts after the anchor), `endsInFuture = window.to > anchor`, `days` = window length.
3. Comparison presets, all with the fact window's length `n` and never past the anchor:
   - `previous_period`: for a calendar preset, what `rangeFor` does today; for rolling presets and custom ranges, the `n` days right before the fact window. Label after "vs": `COMPARE_LABELS[preset]` for presets, `Previous ${n} Days` for custom.
   - `preceding_days`: the `n` days right before the fact window. Only offered when it differs from `previous_period`. Label `Previous ${n} Days`.
   - `year_before`: the fact window shifted back one calendar year (Feb 29 → Feb 28). Label `Same Period Last Year`.
4. Custom comparison: the picked window, clipped to the anchor, then `matchedWindows(factWindow, picked)` (move `matchedWindows` from `compute.ts` to `dates.ts`, re-export or update imports). If the cut shortens the fact window, set `compareFact` to the cut fact window.
5. `computeMetric`: when `spec.compareFact` is set, read the metric over it too and add `compareFact: number | null` to `MetricResult` (null otherwise); `diffPct` uses `compareFact ?? fact`. Status, forecast and plan keep using the full `fact`.
6. `CacheDoc.preset` becomes `key: string` (the `cacheKey`). `cacheKey` for presets stays readable, e.g. `this_quarter:previous_period`, `this_quarter:off`; custom choices get `c:<from>_<to>` parts.
7. Delete `comparePicked` and `PickedComparison` from `compute.ts` and their tests; the UI no longer uses them after Task 3 (Task 3 removes the callers; in this task keep the build green by leaving callers compiling — if removing them breaks `Card.tsx`/`Canvas.tsx`/`App.tsx` types, leave `comparePicked` in place and note it for Task 3).
8. `isStale` is unchanged.

Tests (add, in the existing style):
- preset + `previous_period` equals `rangeFor` for `this_quarter`, `last_28d`, `yesterday` on a fixed `now`.
- custom range ending in the future: factWindow clipped, endsInFuture true; starting after the anchor: factWindow and comparison null.
- `year_before` for `2024-02-29` maps to `2023-02-28`.
- `compareOptions` for `last_7d` omits `preceding_days` (same as previous); for `this_month` includes it.
- custom comparison of 10 days vs a 33-day fact window gives a 10-day `comparison` and a 10-day `compareFact`; a 40-day one gives 33 days and `compareFact` null.
- no comparison window ever ends after the anchor.
- `computeMetric` with `compareFact`: `diffPct` from the recounted value, `fact` unchanged.
- `cacheKey`/`persistable` for preset and custom.
- `controlLabel`: `'This quarter vs previous'`, `'This quarter'` when off.

### Task 2: DateRangePicker component

**Files:**
- Create: `src/ui/DateRangePicker.tsx`, `src/ui/Calendar.tsx`, `src/ui/DateRangePicker.test.tsx`
- Modify: `src/styles.css` (add a `/* --- date range picker --- */` section)

**Consumes:** Task 1's `RangeChoice`, `CompareChoice`, `ComparePreset`, `resolveRange`, `compareOptions`, `controlLabel`, `PRESET_GROUPS`, `PRESET_LABELS`, `formatWindow`.

**Produces:**

```tsx
export function DateRangePicker(props: {
  range: RangeChoice; compare: CompareChoice; now: Date;
  onChange: (range: RangeChoice, compare: CompareChoice) => void;
}): JSX.Element;
```

Behaviour and layout (the user's mock: trigger with a calendar icon; panel with presets on the left and a month calendar on the right):
1. Trigger: a button with a lucide `Calendar` icon and `controlLabel(range, compare)`, `aria-haspopup="dialog"`, `aria-expanded`, accessible name `Date range`. Same height (2rem) and look as `.gy-select`.
2. Panel (`role="dialog"`, `aria-label="Date range"`), anchored under the trigger, right-aligned to it, above the canvas (z-index), `background: var(--card)`, border, radius 0.625rem, soft shadow.
3. Left column: the 12 presets from `PRESET_GROUPS`, flat list, one button each (`aria-pressed` on the current one). Clicking one sets the draft range to that preset. A "Custom" row shows pressed when the draft range is custom (not clickable on its own).
4. Right: `Calendar` for the range. Month header with prev/next chevron buttons (`aria-label` "Previous month"/"Next month"), weekday row Mo–Su, day buttons (`aria-label` like `Tuesday, November 3, 2026`). Days in the draft range are highlighted (ends solid `--primary` with `--primary-foreground`, middle `--muted`); days outside the month are muted. First click starts a custom range (from = to = day), second click sets the other end (swap if earlier). Opens on the month containing the range end (or yesterday for a range ending in the future beyond this month).
5. Below the calendar: a checkbox `Compare` (label text `Compare`). When checked, show, below the main calendar:
   - The comparison options as a row of pressable chips: each `compareOptions(draftRange, now)` entry by its label (`Previous period`, `Previous N days`, `Same period last year`), then `Custom`. Default when switching on: `previous_period`.
   - A second `Calendar` showing the comparison window (from `resolveRange(draftRange, draftCompare, now).comparison`). Clicking days there sets a custom comparison (two clicks, as above). Days after yesterday are disabled.
6. Footer: the resolved windows as text (`formatWindow(range)` and `vs formatWindow(comparison)` when on), then `Cancel` and `Apply` (`.gy-btn`, `.gy-btn-primary`). Apply calls `onChange(draftRange, draftCompare)` and closes. Cancel, Escape and a click outside close without applying. Focus returns to the trigger on close.
7. `Calendar` is a presentational component: `month: Day` (any day in the month), `selected: DateWindow | null`, `isDisabled?: (d: Day) => boolean`, `onPick: (d: Day) => void`, `onMonth: (month: Day) => void`, plus an `aria-label`.

Tests:
- closed trigger shows `This quarter vs previous`; with compare off, `This quarter`.
- opening shows presets and one calendar; ticking Compare shows a second calendar and the options; unticking hides it.
- picking `Last month` then Apply calls `onChange({kind:'preset',preset:'last_month'}, …)`.
- two day clicks on the range calendar then Apply give a custom window (reversed clicks are swapped).
- clicking `Same period last year` then Apply gives `{kind:'preset',preset:'year_before'}`; two clicks on the comparison calendar give a custom comparison.
- Cancel and Escape do not call `onChange`.
- comparison calendar days after yesterday are disabled.

### Task 3: Wire it in; remove the per-card period dropdown

**Files:**
- Modify: `src/App.tsx`, `src/ui/Header.tsx` (`RangeControls`), `src/ui/Canvas.tsx`, `src/ui/Card.tsx`, `src/styles.css`, `src/metrics/compute.ts` (delete `comparePicked` if Task 1 left it)
- Test: `src/App.ready.test.tsx`, `src/App.test.tsx`, `src/ui/Header.test.tsx`, `src/ui/Card.test.tsx`, `src/ui/Canvas.test.tsx`

Behaviour:
1. `App` state: `range: RangeChoice` (initial `{kind:'preset', preset: settings.defaultPreset}`) and `compare: CompareChoice` (initial `settings.comparisonDefault ? {kind:'preset',preset:'previous_period'} : {kind:'off'}`), replacing `preset` and `comparisonOn`. Settings save resets them the same way the preset/comparison reset today. `comparisonOn` passed down becomes `compare.kind !== 'off'`.
2. `refresh` uses `resolveRange(range, compare, now())`, `cacheKey(range, compare)`, and only calls `loadCache`/`saveCache` when `persistable(range, compare)`; otherwise it computes and keeps the doc in state only.
3. `RangeControls` renders `DateRangePicker` in place of the checkbox and select; Refresh and Settings icon buttons stay after it, same row.
4. The toolbar's `gy-period-shown` (date windows under the control) stays, fed from the resolved spec.
5. Card: remove the per-card `<select className="gy-period">`, the `against` state, `onCompare`, the windows line and the `Preset`/`PickedComparison` imports. The comparison row keeps the diff chip and `vs <compareLabel>` as plain text. When the result has `compareFact !== null`, the card's big number shows it (the recounted value) and the diff uses it; the hover title on the number keeps Plan/Forecast. Canvas drops `onCompare` and the `key={compareLabel}` remount trick if nothing needs it any more.
6. Remove now-dead CSS (`.gy-period`, `.gy-windows`, the old `.gy-range` checkbox bits if unused).
7. Update tests that looked for `combobox 'Date range'` to find the trigger button `Date range`; remove the per-card picker tests; add a Card test that `compareFact` replaces the big number and drives the diff.

Verification for every task: `npx tsc --noEmit -p .` clean and `npx vitest run --maxWorkers=4` green.
