# Member default range, plan picker, Markdown tooltips, context chips, checkup cards

Spec: the user's requests in the session of 2026-11-05 (no spec file).

## Global Constraints

1. React 19 + TypeScript + Vitest + Testing Library. Run tests with `npx vitest run <files> --maxWorkers=4` (never unbounded workers: the machine overheats); the full suite once before committing with `npx vitest run --maxWorkers=4`. Typecheck with `npx tsc --noEmit -p .`.
2. Match the surrounding code: dense one-line JSX attributes, short `/** */` comments that say why, CSS in `src/styles.css` next to the related block, `gy-` class prefix (the `dm-` prefix is for classes mirroring the OWOX design system).
3. Writing in comments, tests and UI text: plain, short sentences, no filler.
4. Commit on `feat/gyroscope`, message like `feat: …` / `fix: …`, lowercase, one line saying what users get, ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.
5. `plugin.json` collections are a contract: do not add, remove or rename collections or change their scope.
6. All existing tests keep passing; update tests whose expectations the task deliberately changes.

## Task 1: The default date range is the member's own

Files: `src/store/collections.ts`, `src/App.tsx`, `src/ui/SettingsPage.tsx`, their tests.

1. Today `Settings.defaultPreset` is saved with the other settings in the `settings` collection (scope `project`), so one member's change moves everyone's default.
2. Save the default date range in the `preferences` collection (scope `member`) under its own document id `defaults`, as `{ defaultPreset }`. The other settings (threshold, comparison default, week start) stay in `settings`/`project`.
3. Loading: the member's `defaults.defaultPreset` wins when valid (same validation and legacy `this_*` → `*td` mapping `loadSettings` applies today); otherwise the project's stored `defaultPreset`; otherwise `DEFAULT_SETTINGS`.
4. Saving from the Settings page writes `defaultPreset` to the member document and the rest to the project document. Write the project document without changing its stored `defaultPreset` (it stays the fallback for members who never chose one).
5. The Settings page labels the field so it is clear it applies to the member only: hint text under the select, `Only for you`.
6. Tests: member value overrides project; missing/invalid member value falls back to project; saving writes the preset only to the member document and leaves the project `defaultPreset` as it was.

## Task 2: Plan source picker with search and groups; search matches word starts

Files: `src/ui/ForecastPicker.tsx` (generalise; rename the file and component to `SourcePicker` and update imports), `src/ui/OntologyTab.tsx`, tests (`src/ui/ForecastPicker.test.tsx` or wherever the picker is tested, `src/ui/OntologyTab.test.tsx`).

1. Generalise the forecast combobox into one component used for both rows. Props add the first option's label and the accessible name: forecast keeps `Extrapolated` / `Forecast source`; plan uses `No plan` / `Plan source`. Picking the first option means none (`forecast: null` / `plan: null`).
2. The Plan row uses it in place of today's Data Mart select plus field select: the combobox spans the same two cells as the forecast row's, followed by aggregation, date field and the plan shape select (shape stays where it is). Picking a field sets `plan = { martId, measure: { field, fn }, dateField, shape }`: `fn` null for a metric-level calculated field else the current fn or `SUM`; `dateField` kept when the Data Mart is unchanged else `''`; `shape` kept, default `daily`. Same rules as the forecast picker's onPick today. The field's (i) description tip sits beside the combobox as it does for the forecast.
3. Search fix (the user typed "book" and saw every field of "Facebook Ads Insights", because a match anywhere in the Data Mart title listed the whole group): a query matches an option when every whitespace-separated term of the query is the start of a word in the option's label, its path, or its Data Mart's title. Words split on spaces, punctuation, `_`, `.`, `-` and lower→upper camel-case boundaries. So "book" matches "Planned Booked Revenue" but not "Facebook Ads Insights › ad_id"; "face ad" matches the Facebook group's fields whose label/path has a word starting with "ad". Case-insensitive.
4. Tests: plan picker lists "No plan" then fields grouped by Data Mart; picking a field sets the plan and its Data Mart; "No plan" clears it; "book" lists "Planned Booked Revenue" and not Facebook fields; "face" lists the Facebook group's fields; camel-case path word start ("rev" matches `netRevenue`).

## Task 3: Markdown in every description tooltip

Files: `src/ui/OntologyTab.tsx` (`InfoTip`), `src/ui/Card.tsx` (`WarningHint` if its text can carry Markdown, metric tip already uses it), `src/ui/MarkdownText.tsx`, tests.

1. Every tooltip that shows a Data Mart, field or metric description renders it as Markdown with the app's local renderer `MarkdownText` (paragraphs, line breaks, lists, bold, italics, code, links) instead of raw text. Today the Ontology tab's (i) tips (`InfoTip`: Data Mart note, field notes, forecast field note) show raw text with `[label](url)` and `**bold**` literally.
2. Links inside these tooltips behave as on the cards: a link to an OWOX page goes through the app's `onOpen` (same tab); any other link opens a new tab. Reuse the existing helpers (`owoxPath`, `owoxHosts` as used by `Tip` in Card.tsx) rather than writing new ones. The tooltip must stay open long enough to click a link (Card's `Tip` lingers 200 ms after the pointer leaves; do the same).
3. Native `title` attributes stay plain text (browsers can't render Markdown there).
4. Tests: an Ontology (i) for a description `Has **bold** and a [Traffic Sources](https://app.owox.com/ui/p1/data-marts/m1/data-setup) link` renders a `<strong>` and an `<a>`, and clicking the OWOX link calls `onOpen` with `/ui/p1/data-marts/m1/data-setup`.

## Task 4: Context chips beside the Data Mart name on cards

Files: `src/ui/Card.tsx`, `src/styles.css`, `src/ui/Card.test.tsx`.

1. On the main screen each card's header shows the class's contexts (`ClassNode.contexts`, `{ id, name }[]`) as small pills on the Data Mart name's line, after the name and its (i).
2. Pill style mirrors the OWOX design system's secondary badge: muted background (`var(--muted)`), muted foreground text, `0.6875rem` type, `0.125rem 0.375rem` padding, `9999px` radius, no border; class `dm-badge` (the spec's name for the design system pill) plus a `gy-` modifier for layout if needed.
3. The line never wraps or pushes the card wider: the name keeps its ellipsis, pills don't shrink below their text, and when they don't all fit only the first ones show followed by a `+N` pill whose `title` lists the rest. A simple rule is fine: show at most 2, then `+N`.
4. No pills when the class has no contexts.
5. Tests: two contexts render two pills with their names; four render two and `+2` with the other names in its title; none render nothing.

## Task 5: Checkup contexts as collapsible cards

Files: `src/ui/CheckupTab.tsx`, a new `src/ui/CollapsibleCard.tsx`, `src/styles.css`, `src/ui/CheckupTab.test.tsx`.

1. The design system's component for this is OWOX's `CollapsibleCard` (`/Users/flakss/Projects/owox-data-marts/apps/web/src/shared/components/CollapsibleCard/`). The plugin can't import it (separate app in an iframe), so add `src/ui/CollapsibleCard.tsx` mirroring its structure and look: a card with `rounded-md` corners, a muted background (`bg-muted/50`), a 1px border in `var(--border)` (the user asked for borders), a header row with the title on the left, actions/status on the right and a chevron button that folds the content, and a content area (`px-4 pt-1`, plus bottom padding) that animates its height with the `grid-rows-[0fr] / [1fr]` technique. Props: `title`, `status` (node on the header's right), `collapsed` default, and the content. Use only this component for the blocks; no other new visual patterns.
2. In the Checkup tab, each per-context sub-group (today `.gy-chk-group` with an `h4` and a list) becomes a `CollapsibleCard` titled with the context name. Groups' own plain checks stay as they are.
3. When every check in a context has status `ok` (none running, failed, warned or skipped), its card starts folded and its header shows the done mark `✓` with the screen-reader word `passed`, e.g. "Finance ✓". Otherwise it starts open and shows the worst status mark of its checks (same marks as the group headings). A card's fold state follows the results when a run finishes: a context that becomes all-ok folds; one that gets a failure opens. The user can still toggle it.
4. The chevron button has `aria-expanded` and `aria-controls`; folded content is hidden from the accessibility tree.
5. Tests: an all-ok context renders folded with ✓ and its checks hidden; a context with a failure renders open with ✗; toggling opens and closes it.
