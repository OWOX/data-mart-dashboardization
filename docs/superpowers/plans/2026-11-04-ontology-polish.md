# Ontology Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Polish the screens of the Ontology Model feature, following the user's feedback on screenshots from 2026-11-04.

**Spec:** the user's requests, reproduced here as the binding authority:
1. On the canvas, show a warning icon next to the page title ("Orders") when there are issues. Clicking the icon opens a layer on top that lists all the issues.
2. In the Ontology Model tab, class blocks fold, and they are folded by default.
3. In the Ontology Model tab, an (i) icon shows the description of Data Marts and fields wherever one exists. It is loaded live, never cached.
4. The first-open build page shows its checklist in advance and ticks each point once it is done. The points are as granular as possible:
   1. the project description isn't empty;
   2. the project's critical number has a fact;
   3. the project's critical number has a plan;
   4. a forecast is available;
   5. the same checks for each context.
5. Each point says whether it is required or optional. Plan and forecast are optional.

Builds on `docs/superpowers/specs/2026-11-04-ontology-model-design.md`. Its rules still hold: no crash on missing data, and tokens only.

## Global Constraints

- Run tests with `npx vitest run --maxWorkers=4` only, and keep `npx tsc --noEmit -p .` clean.
- Use only the CSS tokens in `src/styles.css`, in light and dark. Keyboard focus must be visible (`outline: none; box-shadow: 0 0 0 2px var(--primary)`), and every control needs an accessible name.
- Commit after each task with a message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Issues icon and layer in the header

**Files:** `src/ui/Header.tsx`, new `src/ui/IssuesLayer.tsx`, `src/App.tsx`, `src/styles.css`, tests.

1. `Header` gets an optional `notices` prop. When it is non-empty, a lucide `TriangleAlert` icon button appears right after the title, coloured with the orange status token used by "near" cards. Its accessible name is "N issues" (singular "1 issue"). It has `aria-haspopup="dialog"` and `aria-expanded`.
2. Clicking it opens `IssuesLayer`, a popover anchored under the icon and above the canvas (`role="dialog"`, `aria-label="Issues"`). Escape and an outside pointerdown close it, and focus returns to the icon. Its contents:
   1. One group, "Broken references", with one row per `Issue`. Each row shows the class title, then the metric name when there is one, then the issue text.
   2. A group "Model out of date", shown only when the out-of-date notice would show. It reads "The descriptions changed since this model was built." with a "Rebuild to see proposed changes" button.
   3. A footer link, "Review in Ontology Model", which opens Settings on the Ontology tab.
3. Remove both full-width banners from App: the broken-references banner and the out-of-date notice. Their content moves into the layer. Keep the logic that decides each one: count, `dismissedHash`, `outdated !== model.inputHash`.
4. On narrow screens the layer is full width under the header.
5. Tests:
   1. No icon when there are no notices.
   2. The icon's name carries the count.
   3. Clicking opens the dialog and lists each issue's text.
   4. Escape closes it and returns focus.
   5. The out-of-date group shows only when that notice would.
   6. The footer link opens the Ontology tab.

### Task 2: Ontology tab, folded classes and live descriptions

**Files:** `src/ui/OntologyTab.tsx`, `src/ui/FieldPicker.tsx` if present, `src/App.tsx` (pass the mart descriptions), `src/styles.css`, tests.

1. Each class block becomes a disclosure. Its header is a `button` with `aria-expanded` and `aria-controls`. The shown checkbox sits outside the button, so the button never nests an input. The header shows a chevron, the title, the contexts, "N of M metrics shown", and a red "N broken" count when the class has flagged references. All blocks are folded by default. The fold state is local; it is not saved and not part of the draft.
2. Descriptions come from live data only, never from the stored model:
   1. a Data Mart's description is `MartSummary.description` from the list App already fetched this session;
   2. a field's description is `SchemaField.description` from the live `details` (health or on-demand fetch).
   Don't use `MetricDef.description` here.
3. Where a description exists, add a lucide `Info` (i) icon button:
   1. next to the class title, for the Data Mart description;
   2. next to each chosen field in Fact, Plan and Forecast, for that field's description.
   It reveals the text in a tooltip-style popover on hover or focus and on click, with `aria-describedby` or `aria-label` carrying the text. Where there is no description, show no icon.
4. Tests:
   1. Blocks are folded by default and open on click.
   2. `aria-expanded` toggles.
   3. A broken count shows on a folded class header.
   4. The (i) icon shows the live mart and field description, and it reflects `details` passed in, not `MetricDef.description`.
   5. There is no icon when the description is empty.
   6. Save still works with folded blocks: draft edits inside a block survive folding.

### Task 3: Build checklist with required and optional points

**Files:** `src/model/build.ts`, `src/ui/BuildProgress.tsx`, `src/styles.css`, tests.

**Produces:**
```ts
export type CheckId = 'project.description' | 'project.fact' | 'project.plan' | 'project.forecast'
  | 'marts' | 'ai' | 'classes'
  | `context:${string}.description` | `context:${string}.fact` | `context:${string}.plan` | `context:${string}.forecast`;
export type CheckState = 'pending' | 'running' | 'done' | 'missing' | 'failed';
// BuildStep gains: | { kind: 'check'; id: CheckId; state: CheckState; detail?: string }
// plus { kind: 'contexts'; list: { id: string; name: string }[] } once contexts are read
```

1. BuildProgress renders a fixed checklist from the first frame, with every point pending. It has two groups.
2. Group **Project**:
   1. "Project description isn't empty" (required);
   2. "Critical number has a fact" (required);
   3. "Critical number has a plan" (optional);
   4. "Forecast available" (optional);
   5. "Data Marts read: N of M" (required, determinate);
   6. "AI read the descriptions" (required);
   7. "Classes found: N" (required).
3. Group **Contexts**: one sub-group per context, named after it, added as soon as contexts are read. Each has four points, all optional: "Description isn't empty", "Critical number has a fact", "has a plan", "Forecast available". With no contexts it shows "No contexts".
4. Every point carries a small "Required" or "Optional" tag (text, not colour only).
5. States:
   1. pending: an empty circle;
   2. running: a spinner-free pulse, static under reduced motion;
   3. done: ✓;
   4. missing on an optional point: a muted "Not set";
   5. missing or failed on a required point: a red ✗ with the reason as detail. The build then ends in the existing blocked screen.
6. Every state has a visually hidden text.
7. When the points resolve:
   1. description points as soon as inputs are read;
   2. fact, plan and forecast points after the AI step, from the AI output: the critical metric with `source` 'project' or the context id, its `factLink` and `planLink`;
   3. forecast is "done" with detail "Extrapolated from the fact" when the fact has a date field. A metric's forecast source doesn't exist at build time, so extrapolation is the only path.
8. The live region announces only state changes of points, not the Data Mart counter ticks.
9. Fix the "Reading / Found" heading contrast: use `--muted-foreground`, not `--muted`. The old Reading and Found columns become this checklist, and the Found summary (goal, classes, metrics) stays below it.
10. Tests:
    1. All project points render pending before any step.
    2. Context groups appear after the contexts step.
    3. The required and optional tags are present.
    4. Optional missing shows "Not set".
    5. A required missing shows ✗, and the build is blocked.
    6. `buildModel` emits the check steps in order with a fake project that has one context with no plan.
