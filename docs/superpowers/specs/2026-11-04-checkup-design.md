# Checkup tab: design

Date: 2026-11-04. Status: approved in chat (2026-11-04); the user chose to parse the Metrics tables, with no AI call.

## What the user asked for

1. A new Settings tab, Checkup. Whoever sets up the project (a data analyst, usually) opens it to see whether everything Gyroscope needs is in place.
2. The checks the user named: the project description exists; it names the target metric; contexts exist; each context references a plan and a fact; calculated fields connect the classes.
3. More checks, suggested by Claude and accepted (listed below).
4. The checks run live as soon as the tab opens. A refresh icon runs them again.
5. The checks are grouped, each group shows its status, and each failed or warning check links to the page where it is fixed.

## Behaviour

1. Settings gets a third tab, **Checkup**, at the route `/settings/checkup`. A reload on that route opens it.
2. Opening the tab starts a run. Each check shows as running and changes to its result when that result is known. A refresh icon in the tab's header starts a new run, spins while one runs, and the header shows "Checked HH:MM" after a run ends. A refresh drops the results of the run it replaces.
3. Nothing is saved, nothing calls the AI, and `plugin.json` doesn't change.
4. A run never throws. A failed request turns the checks that need it into failed checks, with the error as their detail.
5. The blocked screen has a "Run checkup" button, and `/settings/checkup` opens without a model. Leaving Settings with no model starts the build.

## Statuses

1. Failed (✗): Gyroscope can't build the model or can't track the goal.
2. Warning (⚠): it works, with less (no plan, a class missing from the canvas).
3. Passed (✓).
4. Skipped (–): the check needs an earlier one that failed. Its detail names that one.
5. Running.

A summary line on top counts each status: "2 failed, 3 warnings, 14 passed". Each group heading shows the worst status in the group. A failed or warning check has a Fix link. An OWOX page opens through `ctx.ui.navigate`; the Metrics tab opens inside the plugin.

## Reading the Metrics tables

A Metrics table is a Markdown table whose header row has the columns Role, Plan and Fact (any case, any order). A column named Metric gives the metric's name; without one the name is the Fact link's label. Each body row gives a role, a name, and the Data Mart links in its Plan and Fact cells (read with `extractLinks`). The Critical number row is the first row whose role contains "critical".

This is the table the blocked screen's snippet shows. A description written another way reads as "no Metrics table", and the fix for that check offers the snippet to copy.

## Checks

OWOX paths are relative to `/ui/{projectId}`.

| Group | Check | Not passing | Fix |
|---|---|---|---|
| Where the business is heading | The description isn't empty | Failed | `/project-settings` |
| | It has a Metrics table | Failed | `/project-settings`, plus the snippet |
| | It has a Critical number row | Failed | `/project-settings` |
| | The Critical number's fact links a Data Mart field | Failed | `/project-settings` |
| | The Critical number's plan links a Data Mart field | Warning | `/project-settings` |
| | Every Data Mart and field linked in the description exists | Failed, listing what's missing | `/project-settings` |
| | Goal Data Mart: it is published and you can access it | Failed | `/data-marts/{id}/data-setup` |
| | Goal Data Mart: the goal field exists in it | Failed | same |
| | Goal Data Mart: it has a primary key | Failed | same |
| | Goal Data Mart: it has a date field | Failed | same |
| What drives it | At least two contexts exist | Warning | `/contexts` |
| | Per context: the description isn't empty | Warning | `/contexts` |
| | Per context: at least one Data Mart is in it | Warning | `/contexts` |
| | Per context: a metric row links a fact | Warning | `/contexts` |
| | Per context: a metric row links a plan | Warning | `/contexts` |
| | Per context: every linked Data Mart and field exists | Failed, listing what's missing | `/contexts` |
| How it connects | The goal is reachable: you can access its Data Mart, or a calculated field references it | Failed | goal Data Mart |
| | Calculated fields reference other Data Marts | Warning: "No calculated field references another Data Mart" | `/data-marts` |
| | Each Data Mart with a fact link connects to the goal | Warning, listing the Data Marts that won't show on the canvas | that Data Mart |
| | Each Data Mart with a fact link has a primary key | Warning, listing them | that Data Mart |
| Housekeeping | An AI credential is mapped | Failed | `/plugins` |
| | No broken references | Warning, with the count | Metrics tab |
| | It matches the descriptions | Warning: "The descriptions changed since the model was built" | Metrics tab |

With no saved model, both Saved model checks are skipped with the detail "No model built yet".

A passed check can carry a detail, for example "Retail net revenue (Orders)" for the Critical number or "6 connections" for the calculated fields.

## Code

1. `src/checkup/types.ts`: `Check`, `CheckStatus`, `Fix`, `GroupId`.
2. `src/checkup/tables.ts`: `findMetricTables(markdown, source)`.
3. `src/checkup/run.ts`: `runCheckup({ owox, hasAi, model, projectId, onUpdate })`. It reuses `fetchInputs`, `fetchMartDetail`, `fetchBlendable`, `allFieldPaths`, `buildEdges`, `chooseMain`, `classDepths`, `hasPrimaryKey`, `checkHealth` and `currentInputHash`, with at most 6 requests at a time. `onUpdate` receives the whole list each time a check changes.
4. `src/ui/CheckupTab.tsx`: the summary, groups, refresh button and Fix links, styled like the build checklist.
5. `SettingsPage` and `App`: the tab, the route, and the `run` closure.

## Out of scope

1. Reading descriptions that don't use the Metrics table.
2. Fixing anything from the tab itself.

## Risks

1. Every run requests the schema and blendable schema of each accessible Data Mart, as a build does. In a project with 50+ Data Marts the Connections group can take several seconds; the other groups finish first.
2. A description the AI build reads but the table parser doesn't shows failures here that the build wouldn't hit.
