# Ontology Model: design

Date: 2026-11-04. Status: draft for review.

## What the user asked for

1. Settings gets tabs. A new tab, "Ontology Model", lists the classes, the metrics recognized for each, and each metric's plan, fact and forecast source. All of it is editable.
2. The plugin is the only source of the ontology model. The project and Data Mart descriptions feed a build or a rebuild; after that the model the member sees is the one stored by the plugin, edits included.
3. The model is stored per member, as JSON.
4. With no model, opening the plugin starts the build automatically. Progress shows what is being read (project description, contexts, Data Marts) and what has been found (classes, metrics).
5. Once a model exists, Rebuild proposes changes as before / after. Nothing is overwritten without the member's confirmation.
6. The member picks which detected classes and metrics show in the report, with checkboxes.
7. Forecast source: an optional Data Mart field per metric. With none set, the current extrapolation stays.
8. Edit scope: metrics and their references, plus which metric is the key one. Classes and the links between them stay as built.

## Storage

| | Today | New |
|---|---|---|
| Collection | `model`, project scope, one shared doc | `ontology`, member scope, doc `current` |
| Who builds | any member, for everyone | each member, for themselves |
| Edits | none | stored in the same doc |

1. `plugin.json` adds `ontology` (member). Collections are fixed within a compatibility line, so this ships as **v0.3.0**.
2. `model` (project) stays in the manifest for one line, read-only: a member with no `ontology` doc gets the project model copied in as their starting point, with no AI call. A member with no project model either builds from scratch. The plugin stops writing `model`.
3. The doc is the existing `Model` JSON with the additions below and `version: 2`. A `version: 1` doc is upgraded on load.

## Model additions

```ts
interface MetricDef {
  // existing fields unchanged
  shown: boolean;                 // checkbox: appears on the card
  forecast: ForecastDef | null;   // null: extrapolate from the fact series, as today
}
interface ForecastDef { martId: string; measure: Measure; dateField: string }
interface ClassNode {
  // existing fields unchanged
  shown: boolean;                 // checkbox: appears on the canvas; the goal class is always shown
}
interface Model {
  // existing fields unchanged
  version: 2;
  editedAt: string | null;        // last manual edit; part of the cache key, so an edit refreshes the numbers
}
```

The cache treats `builtAt` plus `editedAt` as the model version, so an edit invalidates the member's cached numbers the same way a rebuild does.

## Build with progress (first open, no model)

The build runs on open instead of waiting for a "Build model" click. Its page shows the loading line and two lists, filled as each step finishes:

| Reading | Found |
|---|---|
| 1. Project description ✓ | Goal: Retail net revenue (Orders) |
| 2. Contexts: 11 ✓ | Classes: 8 (Orders, Customers, …) |
| 3. Data Marts: 14 of 23 | Metrics: 41 |
| 4. AI reading descriptions… | |

`buildModel` gets an `onStep` callback. "Found" fills in after the AI step and validation. A blocked build shows the existing blocked screen, with its links.

## Ontology Model tab

1. Settings gets tabs: **General** (the existing fields) and **Ontology Model**. Rebuild model moves from General to this tab. The tab is the page route `/settings/ontology`.
2. The list is grouped by class, in canvas order, goal first. Each class row: a checkbox (disabled for the goal), the title and contexts. Under it, one row per metric:
   1. a checkbox for shown;
   2. a key metric radio;
   3. the name, editable;
   4. the role: critical, leading, lagging or unique;
   5. Fact: field and aggregation from the class's Data Mart schema, plus a date field;
   6. Plan: none, or Data Mart, field, aggregation, date field and shape;
   7. Forecast: none (extrapolated), or Data Mart, field, aggregation and date field.
3. Field pickers list only real fields of the chosen Data Mart, from its schema. A choice that no longer exists after a schema change is flagged in red with the old name kept.
4. Changes are kept as a draft until **Save**. Cancel drops them. Save writes the doc, sets `editedAt` and returns to the canvas, which refreshes.

## Rebuild as a proposal

1. Rebuild builds a candidate model with the same progress view and doesn't save it.
2. The tab then shows the differences, before / after, one row per change:
   1. a class added or removed;
   2. a metric added or removed;
   3. a metric's name, role, fact, plan or date field changed.
   Every row has a checkbox, all on by default.
3. **Apply selected** merges the checked rows into the current model and saves it. **Discard** keeps the model as it is. Manual edits that the member didn't select for replacement stay. `shown` flags and forecast sources are never replaced by a rebuild.
4. With no differences, the tab says the model already matches the descriptions.

## Forecast from a source

When `forecast` is set, the card's forecast is the forecast field over the range: a sum for a flow, or the value on the range's last day for a level. The sparkline's dashed part draws that field's daily values after the anchor. Status is still judged by the forecast while the range is running. If the forecast query fails, the card falls back to extrapolation and the info tooltip says so.

## Out of scope

1. Adding or removing classes and links by hand.
2. Sharing one member's model with others, and export or import of the JSON.
3. Writing edits back to the project or Data Mart descriptions.

## Risks

1. Each member's first open runs the AI build once (or copies the project model). AI cost goes from once per project to once per member who has no project model to copy.
2. Members can see different numbers on their canvases, because each one's model can differ.
3. v0.3.0 is a new compatibility line. Every installation moves to it, and its cache docs are rebuilt on first open.

## Questions for review

1. Is seeding a member's model from the existing project model right, or should every member start with a fresh AI build?
2. Does "stored in user level json format" also mean export and import of the JSON file? This spec leaves export and import out.
