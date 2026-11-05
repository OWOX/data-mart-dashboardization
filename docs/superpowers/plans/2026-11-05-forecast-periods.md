# Forecast periods, calendar month and year lists, Gyroscope title

Spec: the user's requests in the session of 2026-11-05 (no spec file). Today in examples is 2026-11-05; the anchor (last day with data) is yesterday, 2026-11-04.

## Global Constraints

1. React 19 + TypeScript + Vitest + Testing Library. Run tests with `npx vitest run <files> --maxWorkers=4` (never unbounded workers: the machine overheats). Typecheck with `npx tsc --noEmit -p .`.
2. Match the surrounding code: dense one-line JSX attributes, short `/** */` comments that say why, CSS in `src/styles.css` next to the related block, `gy-` class prefix.
3. Writing in comments, tests and UI text: plain, short sentences, no filler.
4. Commit on the current branch `feat/gyroscope` with a message in the repo's style (`feat: …` / `fix: …`, lowercase, one line saying what users get), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.
5. All existing tests must keep passing; update tests whose expectations the task deliberately changes.

## Task 1: Gyroscope as the page title

Files: `src/ui/Header.tsx`, `src/App.tsx`, `src/ui/Header.test.tsx`, `src/styles.css` (only if a rule becomes dead).

1. The header's `<h1 className="gy-header-title">` always reads `Gyroscope`. Today it shows the main class title (e.g. "Orders") via `title={main?.title ?? 'Gyroscope'}` in `App.tsx`.
2. Delete the small light `<div className="label">GYROSCOPE</div>` above it.
3. Remove the `title` prop from `Header` and from its call site. Delete any CSS that only served the removed label, if such a rule exists and nothing else uses it.
4. Tests: the header shows "Gyroscope" as its heading whatever the model's classes are; no "GYROSCOPE" label element.

## Task 2: Full periods with forecast, and "to date" periods

Files: `src/types.ts`, `src/lib/dates.ts`, `src/store/collections.ts`, `src/metrics/compute.ts`, plus every consumer that shows a metric's value or difference (`src/ui/Card.tsx`, `src/ui/Badge.tsx`, others found by grep), and their tests (`src/lib/dates.test.ts`, `src/store/*.test.ts`, `src/metrics/*.test.ts`, `src/ui/*.test.tsx`).

### Presets

| id | label (`PRESET_LABELS`) | range | after "vs" for previous_period (`COMPARE_LABELS`) |
|---|---|---|---|
| `cur_year` | This year | Jan 1 – Dec 31 of today's year | Last Year |
| `cur_quarter` | This quarter | today's quarter, whole | Last Quarter |
| `cur_month` | This month | today's month, whole | Last Month |
| `cur_week` | This week | today's week, whole | Last Week |
| `ytd` | This year to date | first day of the anchor's year – anchor | Last Year to Date |
| `qtd` | This quarter to date | first day of the anchor's quarter – anchor | Last Quarter to Date |
| `mtd` | This month to date | first day of the anchor's month – anchor | Last Month to Date |
| `wtd` | This week to date | first day of the anchor's week – anchor | Last Week to Date |
| `last_*`, `yesterday` | unchanged | unchanged | unchanged |

1. The `this_*` ids are removed from `Preset`. On load (`loadSettings`, `loadPreferences` in `src/store/collections.ts`) a stored `this_year|this_quarter|this_month|this_week` maps to `ytd|qtd|mtd|wtd`: those ids used to mean actual-to-date, so a saved choice keeps its numbers. Unknown ids keep falling back as today.
2. `DEFAULT_SETTINGS.defaultPreset` becomes `qtd` (same numbers as the old default).
3. `PRESET_GROUPS`: Current = `cur_year, cur_quarter, cur_month, cur_week`; To date = `ytd, qtd, mtd, wtd`; Past unchanged.
4. `CALENDAR_UNIT` covers all eight new ids. The to-date ids take the anchor's period (on Nov 1 `mtd` is Oct 1 – Oct 31), as `ytd` does today.

### Windows (`rangeFor`, `resolveRange`, `compareOptions` in `src/lib/dates.ts`)

Call a range *projected* when `range.to > anchor` and `factWindow !== null` (part past, part future). This applies to the `cur_*` presets and to a custom range that runs past the anchor.

1. Not projected: everything works as today (comparisons are cut to the fact window's length).
2. Projected: comparisons cover the whole range's length, not the fact window's:
   1. `previous_period`, calendar preset: the whole previous calendar period (Nov 1–30 → Oct 1–31; 2026 → 2025 Jan 1 – Dec 31). No cut to the shorter length; `compareFact` stays null.
   2. `previous_period`, custom range: the `range.days` days before `range.from`.
   3. `preceding_days`: the `range.days` days before `range.from`; offered only when it differs from previous_period, as today. Its label is `Previous ${range.days} days`.
   4. `year_before`: the whole range one year back (`yearBefore(range)`), clipped to the anchor.
   5. A custom comparison: the picked window clipped to the anchor, not cut to any length; `compareFact` null.
3. Add to `RangeSpec`: `forecastWindow: DateWindow | null` = `{ from: anchor + 1, to: range.to }` when projected, else null.

### Values (`src/metrics/compute.ts`, `src/types.ts`)

1. Add to `MetricResult`: `projection?: { actual: number | null; factWindow: DateWindow; forecastWindow: DateWindow; source: { kind: 'mart'; martId: string; field: string } | { kind: 'trend'; days: number } } | null`. Set it when the spec is projected and a forecast was computed; `source` says where the forecast came from: the metric's forecast Data Mart (`metric.forecast.martId`, `metric.forecast.measure.field`) or extrapolation (`kind: 'trend'`, `days` = the history length `forecastFor` uses, 90; export that constant from `src/lib/stats.ts` rather than repeating 90).
2. When projected and the forecast exists: the metric's shown value is `forecast` (actual + forecast for sums and counts; the value at the range's end for levels and averages, as `forecast` already is), and `diffPct` is measured between `forecast` and `comparison`.
3. When projected and there is no forecast (short history, broken source): `comparison` and `diffPct` are null (a partial total against a whole period would mislead), `projection` is null, and the card shows the actual value as today with its existing note.
4. Add one helper `shownValue(res: MetricResult): number | null` (`res.projection ? res.forecast : res.fact`) and use it everywhere a card or badge shows a metric's value or computes its absolute difference (Card's big number and `delta`, Badge's value, direction/arrow logic). Grep for `.fact` in `src/ui` to find them. The `≈` prefix for an approximate forecast keeps working.
5. `cacheKey` changes on its own because the ids changed; check that a stale cached doc for a removed `this_*` key cannot be served for a new id.

### Tests

1. `dates`: for now = 2026-11-05: `cur_month` range Nov 1–30, fact Nov 1–4, forecastWindow Nov 5–30, previous_period Oct 1–31, year_before Nov 1–30 2025, preceding_days Oct 1–30 (30 days); `mtd` Nov 1–4 vs Oct 1–4; `cur_year` vs 2025 Jan 1 – Dec 31; on 2026-11-01 `mtd` is Oct 1–31; a custom range Nov 1–10 compared with the 10 days before Nov 1.
2. `collections`: stored `this_month` loads as `mtd`, in settings and in preferences.
3. `compute`: projected sum metric: shown value = forecast, diffPct against the whole previous period, projection filled with source kind; projected with short history: comparison and diffPct null, projection null.
4. Card/Badge: a projected result shows the forecast as the big number and the difference from it.

## Task 3: Range picker for the new presets, comparison windows and the forecast footnote

Files: `src/ui/DateRangePicker.tsx`, `src/ui/DateRangePicker.test.tsx`, `src/styles.css`. Depends on Task 2.

1. The preset list shows the three groups in order (Current, To date, Past) with the new labels, then Custom, as one scrolling list (as today; no group headings).
2. Each comparison option shows its window in grey after its name, e.g. `Previous period` then `Oct 1–31`. Use `formatWindow` from `src/lib/format.ts`, without the year when the window is in the anchor's year.
3. Picker chip names: `Previous period`, `Previous ${n} days` (n = the comparison's length from Task 2), `Same period last year`.
4. Forecast footnote: when the drafted range is projected, the summary line in the panel's head reads the range followed by a superscript `*`, e.g. `Nov 1–30* vs Oct 1–31, 2026`, and under it a smaller muted line `* Nov 5–30 forecast`. Hovering or focusing the footnote shows a tooltip: `Nov 5–30 hasn't happened yet. Each card fills these days with its metric's forecast: from the forecast Data Mart set in the Ontology, or else from the trend and weekday pattern of the last 90 days.` (90 = the constant exported in Task 2; dates via `formatWindow`). Use the app's existing tooltip styles (`gy-hint`, `gy-hint-body`). No footnote when the range is not projected.
5. Tests: the list order and labels; the grey window beside each comparison option; the footnote and its tooltip text for `cur_month`, none for `mtd`.

## Task 4: Month and year lists in the calendar

Files: `src/ui/Calendar.tsx`, `src/ui/DateRangePicker.tsx` (to pass the year bounds), `src/ui/Calendar.test.tsx` (create if missing) or `DateRangePicker.test.tsx`, `src/styles.css`.

1. The calendar's title `November 2026` becomes two buttons: the month name and the year.
2. Pressing the month opens a vertical list of the 12 months; pressing the year opens a vertical list of years. Picking an item shows that month (calls `onMonth` with the first day of the new month) and closes the list. It does not change the selected range.
3. The year list runs from 10 years before the anchor's year to the anchor's year + 1, passed from the picker as props; the current year is in view and marked.
4. The list is a popover under the title, over the calendar grid, styled like the app's existing custom dropdown list (`src/ui/Select.tsx` and its CSS; reuse its classes or component if it fits). Keyboard: arrows move, Enter picks, Escape closes the list only (stop propagation so the picker panel stays open); a click outside closes it.
5. Both calendars (range and comparison) get it.
6. Tests: open the month list, pick March → the calendar shows March of the same year; open the year list, pick 2024 → same month in 2024; Escape closes the list and leaves the panel open.

## Task 5: Footnote on the card's value

Files: `src/ui/Card.tsx`, `src/ui/Card.test.tsx`, `src/styles.css`, and whatever passes Data Mart titles to cards if they are not reachable yet (`src/ui/Canvas.tsx`, `src/App.tsx`). Depends on Task 2.

1. When the key metric's result has `projection`, a small muted footnote sits next to the big number, at the top of the number: `*16% forecast`, where the share is by days: forecastWindow days / (factWindow days + forecastWindow days), rounded to a whole percent.
2. Hover or focus on the footnote shows a tooltip (same tooltip mechanism as the card's other hints):
   1. `Actual: Jan 1 – Nov 4 · 308 days · 84%` plus the actual value formatted like the metric when `actual` is not null.
   2. `Forecast: Nov 5 – Dec 31 · 57 days · 16%`.
   3. Source: `From <Data Mart title>, <field>` for a mart source, or `Trend and weekday pattern of the last 90 days` for a trend source.
3. The percentages of the two lines add up to 100.
4. No footnote when there is no projection. A secondary metric swapped in as the key metric gets the footnote from its own result.
5. Tests: projected result → footnote text and tooltip lines; non-projected → no footnote; mart source shows the mart's title.
