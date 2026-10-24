# Gyroscope design

**Date:** 2026-10-24
**Status:** approved in conversation, implementation started the same day
**Replaces:** the Data Mart Dashboards plugin in this repository

## 1. Problem and goal

CEOs skip routine analytics. Reports look backwards, take effort to read, and rarely say whether the company is on track.

Gyroscope is an OWOX Data Marts plugin that answers one question first: are we on track for the goal in the project description? It draws a canvas of business classes. The class that owns the goal sits on top. Below it sit the classes that class depends on. Each card shows one key metric against plan, with a trend and a forecast when the range ends in the future.

## 2. Terms

| Term | Meaning in Gyroscope |
|---|---|
| Ontology model | The saved subset of Data Marts with their business metrics, built from project and context descriptions |
| Class | A Data Mart with a primary key, for example Customers, Orders, Pages |
| Subclass | A Data Mart defined by referencing another class. Not drawn in v1 |
| Property | A business-relevant field of a class. Out of scope in v1 |
| Connection | Class A connects to class B when a calculated field of A references a field of B |
| Canvas | The screen that draws connected classes as cards |

## 3. Platform

Gyroscope follows the public plugin authoring guide (https://docs.owox.com/docs/plugins/authoring-guide/).

1. It is a UI-only plugin: React, TypeScript, Vite and `@owox/plugin-sdk`. There are no backend actions.
2. GitHub Pages serves the page. `plugin.json` sits at the repository root.
3. There are no scheduled runs. Schedules start only backend actions, and logical AI is not available in a backend. Data refreshes while a member has the plugin open.
4. The page sees only what the installing member may see. `ctx.owox` carries that member's authority.

Manifest:

```json
{
  "name": "Gyroscope",
  "delivery": { "type": "remote", "url": "https://<org>.github.io/gyroscope/" },
  "credentials": ["ai"],
  "collections": [
    { "name": "model", "scope": "project" },
    { "name": "cache", "scope": "project" },
    { "name": "settings", "scope": "project" }
  ]
}
```

## 4. Inputs

| Input | Endpoint |
|---|---|
| Project description | `ctx.owox.project.getSettings()`, which calls `GET /api/projects/settings` |
| Contexts with descriptions | `GET /api/contexts` |
| Visible Data Marts | `ctx.owox.dataMarts.list()` |
| Schema, primary keys, calculated fields | `GET /api/data-marts/{id}` |
| Reference paths to other marts | `GET /api/data-marts/{id}/blendable-schema` |
| Metric values | `ctx.owox.dataMarts.traverseData(id, { column, filter, aggregation, dateTrunc })` |

## 5. Building the ontology model

Code builds the structure. The AI only reads prose. Every AI answer is checked against real schemas before it is saved.

### 5.1 Units

| Unit | Job | AI |
|---|---|---|
| `sources` | Fetch the inputs in section 4 | No |
| `interpret` | Read project and context descriptions; return metric bindings | Yes |
| `graph` | Parse calculated-field references; build connections; choose the main class | No |
| `validate` | Check every binding against the schemas; return a model or a list of blockers | No |
| `metrics` | Query fact, comparison, daily series and plan; compute forecast and statuses | No |
| `canvas` | Lay out cards and render them | No |

### 5.2 What the AI returns

For each metric mentioned in the project description or a context description:

```ts
{ role: 'critical' | 'leading' | 'lagging', source: 'project' | <contextId>,
  alias: string,                        // "ARR", as written in the metrics table
  fact: { martId, field, dateField },
  kind: 'flow' | 'level',               // flow is summed over the range; level reads the last day
  plan?: { martId, field, dateField, shape: 'daily' | 'cumulative' | 'level' } }
```

Mart ids and field names come from the Markdown links (`/data-marts/<id>/...?field=<name>`). The AI reads `kind`, `shape` and `dateField` from the surrounding prose ("Plan values are cumulative from Oct 1", "Do not sum ARR across days", the "Date field for the period" column). The AI runs only when a member clicks Build model or Rebuild model.

### 5.3 Connections

1. A reference is `{{ref path="<alias chain>" field="<name>"}}` inside a calculated field's formula. A reference without `path` stays inside its own mart and makes no connection.
2. The `path` resolves to a target mart through the blendable schema of the mart that owns the formula.
3. A connection exists only when both marts are visible to the member and every mart along the path is visible. A path through a hidden mart draws nothing.
4. Classes are visible marts with a primary key that are reachable from the main class through connections. Context attachment is not required.

### 5.4 Main class

1. The goal is the project description's critical metric. Its fact mart is the goal mart.
2. If the member can see the goal mart, it is the main class.
3. Otherwise the main class is the visible mart with the fewest reference steps to the goal mart. Ties go to a mart whose formula references the goal field itself, then to the alphabetical title.
4. Gyroscope never guesses a goal. Section 9 lists the blocked states.

### 5.5 Key metric and secondary metrics

A class's metrics are the metrics bound to it in section 5.2, plus Unique Count. The key metric is the first match in this order:

1. The project's critical metric.
2. A context's critical metric.
3. A leading metric, in table order.
4. Unique Count.

The other metrics become badges.

### 5.6 Saved model

One document `current` in the `model` collection:

```ts
{ inputHash, builtAt, builtBy,
  goal: { classId, metricId },
  classes: [{ id, martId, title, contexts: string[], depth, keyMetricId, metricIds: string[] }],
  edges:   [{ from, to }],
  metrics: [{ id, martId, alias, field | 'unique_count', aggregation, kind, dateField,
              plan?: { martId, field, dateField, shape } }] }
```

`inputHash` hashes the project description, the context descriptions and the schemas of the classes. When the hash of the current inputs differs, the page shows a "Model is out of date" banner and keeps rendering the old model.

## 6. Date ranges

All dates are UTC. The anchor is yesterday.

| Group | Presets | Window |
|---|---|---|
| Past | Last year, last quarter, last month, last week | The previous full calendar period. Weeks run Monday to Sunday |
| Past | Last 28 days, last 7 days, yesterday | N days ending at the anchor |
| To date | YTD | Jan 1 to the anchor |
| Full current | This year, this quarter, this month, this week | The whole period. Days after the anchor are forecast |

Comparison is optional and on by default. It covers the same number of days directly before the range.

## 7. Metrics

### 7.1 Queries per metric

1. The fact total for the range, clipped to the anchor. Unique Count has its own total query because daily unique counts do not add up.
2. The fact total for the comparison window.
3. Daily values for the 90 days before the anchor plus the range.
4. Plan values for the range.

Level metrics take the value on the last day from the daily series. Queries run 6 at a time. A failed query fails only its own card or badge.

### 7.2 Forecast

The forecast appears only when the range ends after the anchor.

1. Fit a least-squares line to the daily values of the 90 days ending at the anchor.
2. A flow forecast is the fact up to the anchor plus the fitted values for the remaining days.
3. A level forecast is the fitted value on the last day of the range.
4. With fewer than 14 days of history there is no forecast, and the card says so.
5. Unique Count forecasts extend the fitted daily unique counts. They overstate totals when the same entities return on several days, so the card marks them with "≈".

### 7.3 Plan

| Shape | Plan for the range |
|---|---|
| `daily` | Sum of the daily plan values in the range |
| `cumulative` | The plan row on the last day of the range minus the row on the day before the range starts (or the row itself when the range starts at the plan's period start) |
| `level` | The plan row on the last day of the range |

### 7.4 Statuses

`gap = (value − plan) / plan`, where value is the forecast when there is one, else the fact.

| Gap | Status | Colour |
|---|---|---|
| No plan | neutral | blue border, grey badge |
| gap > 0 | above | green `#27ae60` |
| −threshold ≤ gap ≤ 0 | near | orange `#f2994a` |
| gap < −threshold | below | red `#eb5757` |

The threshold comes from settings and defaults to 20%. The default border is blue `#459ce9`.

Trend is the sign of the fitted slope over the range's daily values: up, down or flat (exactly zero). It colours the sparkline (green up, red down) and picks the badge icon (lucide trending-up, trending-down, move-right).

## 8. Canvas and card

### 8.1 Layout

1. The main class is on top. Each row below is one reference step further away.
2. A row of context chips above the canvas filters classes: All, then one chip per context. Multi-select, default All. Marts without a context appear only under All.
3. The main class is always visible. When a filter hides a class between two visible ones, a dashed connector joins them.
4. The header holds the date range picker, the comparison toggle, Refresh, Rebuild model and Settings.

### 8.2 Card

```
┌──────────────────────────────────┐   border: plan status of the key metric
│ CUSTOMERS                        │   class name
│ $1.24M ▲ +8.3%                   │   key value, % diff vs comparison
│ ARR from Customers               │   label
│ ╱╲_╱‾‾╲_╱‾‾‾‾‾ ┈┈┈               │   sparkline, dashed part is forecast
│ [ 7.1K Revenue ↗ ] [ 103K MRR → ] │   secondary metric badges
│ plan $1.30M · forecast $1.35M    │   versions present in the range
└──────────────────────────────────┘
```

1. The label reads "`<metric> from <Class>`", for example "ARR from Customers". The metric name is the alias from the metrics table, else the field's display name.
2. Unique Count reads "`<value> <Class>`", for example "1,234 Customers". Gyroscope never prints the words "Unique Count".
3. The % diff compares against the comparison window. With comparison off, the card shows no % diff.
4. A badge reads value first, then name, then the trend icon: `[ 7.1K Revenue ↗ ]`. It reuses the `.dm-badge` pill from data-flow and owox.com. Its fill follows the metric's plan status.
5. Numbers use Space Mono with tabular figures. Colours come from the OWOX design system in the project description.

## 9. States

| State | Screen |
|---|---|
| No goal in the project description | Blocked: "Goal can't be tracked", reason, numbered fix steps, a copy-ready metrics-table snippet, a link to the project settings |
| Goal link is a placeholder or broken | Blocked, same layout, names the broken link |
| Goal field not found in its mart | Blocked, names the mart and field |
| Goal mart has no primary key | Blocked |
| No visible mart connects to the goal mart | Blocked |
| `ctx.credentials.ai` absent | Blocked: "Ask a project admin to map an AI model" |
| AI answer fails validation | Model not saved; list of mismatches; Retry |
| Model out of date | Banner with Rebuild model; old model keeps rendering |
| Card query fails or times out | That card only: grey border, "Couldn't load", Retry |
| Refreshing | Cached cards stay; 2px progress bar on top |
| Fewer than 14 days of history | No forecast; "Not enough history to forecast" |

## 10. Cache

One document per range and comparison setting in the `cache` collection, id `<preset>:<cmp|nocmp>`:

```ts
{ modelHash, anchor: 'YYYY-MM-DD', refreshedAt,
  cards: { [classId]: { metrics: { [metricId]: MetricResult }, status: 'ok' | 'error', error? } } }
```

The canvas reads only from this cache. A refresh starts when the cached anchor is not yesterday or `modelHash` differs from the saved model. The Refresh button forces one.

## 11. Settings

A Settings page inside the plugin stores one document `project` in the `settings` collection.

| Setting | Default |
|---|---|
| Plan threshold for red | 20% |
| Default date range | This quarter |
| Comparison on by default | Yes |
| Properties | Not in v1 |

## 12. Testing

| Layer | How |
|---|---|
| Pure units: ref parsing, graph, main class, layout, date ranges, forecast, plan shapes, statuses, validate, labels | Vitest, table-driven, `--maxWorkers=4` |
| `sources`, `metrics` | Vitest with a fake `ctx.owox` serving recorded responses |
| `interpret` | Vitest with a stub model returning fixed output; bad output is rejected |
| Card, canvas, blocked screens | Testing Library |
| End to end | Install in the OWOX project and walk through the blocked state, then a fixed goal |

## 13. Out of scope for v1

1. Scheduled refresh and backend actions.
2. Properties.
3. Drawing subclasses.
4. AI-written insights.
