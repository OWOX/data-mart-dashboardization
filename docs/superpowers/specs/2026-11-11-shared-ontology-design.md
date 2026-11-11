# Shared ontology and the ontology view: design

Date: 2026-11-11. Status: draft, waiting for answers to the open questions at the end.

Supersedes parts of two specs:

1. [Ontology Model](2026-11-04-ontology-model-design.md): storage per member, the seed cut to accessible Data Marts, and risk 2.
2. [Gyroscope design](2026-10-24-gyroscope-design.md): sections 5.3.3, 5.4.2 to 5.4.3, 6 (default range), 8.1, 8.2, 9 (no-access row) and 11 (default range).

## Goal

Gyroscope presents the whole project ontology: the business classes and how they connect. Time series are optional. The member sees numbers only after choosing a date range, and then the canvas shows how value is generated and flows through the classes to the critical number.

## What the user asked for

1. The model is the same for every member of a project. Today two members of one project see different cards. That is a bug.
2. The default view is the ontology view. Its cards show the class name only: no numbers, no sparklines, no badges.
3. The goal class sits in the center. It is the class that owns the critical number, for example Revenue owning net profit.
4. Around it sit 3 to 5 core classes. Core classes are dictionary classes, such as Users, Customers, Visitors or Products, connected to each other and to the goal class.
5. A core class has a unique ID and as many inbound references as possible. It may have no date field.
6. The date range is empty by default. With no range, the canvas is the ontology view. This replaces "last quarter", "this quarter" and every other preset as the default.
7. Once a range is chosen, the canvas shows metrics on the goal and core classes, plus the classes connected to them, to show how value flows through the business.

## 1. Why members see different cards today

| Cause | Where |
|---|---|
| The model lives in the `ontology` collection, member scope. Each member builds, edits and rebuilds their own copy | `plugin.json`, `src/store/collections.ts` |
| A member's first model is the project model cut to the Data Marts that member can access | `seedFrom` in `src/model/seed.ts` |
| A build draws a connection only when every Data Mart on the path is visible to the member who runs it | Gyroscope design 5.3.3 |
| The main class falls back to the nearest visible Data Mart when the member can't see the goal Data Mart | Gyroscope design 5.4.3 |
| A class needs a date field (`canBeClass`), and `withoutUndated` drops undated classes per member | `src/model/graph.ts`, `src/model/seed.ts` |

Every row has to change. Access may decide which numbers a member sees. It must not decide which classes and connections the member sees.

## 2. One model per project

1. The model lives in one project-scoped document. Collections are fixed within a compatibility line, so this ships as v0.4.0 with a new collection, `ontology_project` (project scope), doc `current`. `plugin.json` `delivery.url` moves to `/v4/`.
2. Every member reads the same doc. Edits, Rebuild and Apply selected write it for everyone. Each save sets `editedBy` and `editedAt`. The Ontology Model tab shows "Last edited by <name>, <date>".
3. A save checks that the doc hasn't changed since it was read (`editedAt` or `builtAt`). If it has, the save stops and says "<name> changed the model at <time>. Reload to see their changes." Nothing is merged silently.
4. The build is no longer limited by what the building member can see. Data Mart titles, primary keys and references come from the project's Data Mart list and schemas. Open question 2 covers a member who can't read some schemas.
5. The member-scoped `ontology` and project-scoped `model` collections stay in the manifest, read-only, as sources for the first project doc (open question 1). The plugin stops writing them.
6. `cache` stays member-scoped. Numbers are still computed with each member's own access.
7. `seedFrom` and `withoutUndated` go. A class no longer needs a date field.

### Access on the canvas

| Member can read the class's Data Mart | Ontology view | Flow view |
|---|---|---|
| Yes | Class name | Class name and metrics |
| No | Class name, same card as everyone else | Class name, a lock icon and "No access to this Data Mart". No query runs |

The member sees the same classes and connections either way. Only the numbers depend on access.

## 3. Classes in the model

### 3.1 Goal class

The goal class is the Data Mart that owns the critical number from the project description's Metrics table. It no longer falls back to the nearest visible Data Mart: with one model per project there is nothing to fall back from. If the goal Data Mart is deleted, the blocked screen names it, as today.

### 3.2 Core classes

Core classes are picked by code, not by the AI, so every build of the same project gives the same set.

1. A candidate is a Data Mart with a single-column primary key. A date field is not required. The goal Data Mart is not a candidate.
2. A candidate must connect to the goal class: a calculated field of the goal Data Mart references it, or one of its calculated fields references the goal Data Mart. Open question 3 asks whether a two-step path counts.
3. Candidates are ranked by inbound references: the number of distinct Data Marts in the project whose calculated fields reference the candidate. Ties go to more connections with other candidates, then to the alphabetical title.
4. Gyroscope takes the top 5. A candidate with no inbound references is never core.
5. With fewer than 3 candidates, the canvas shows those that exist, and Checkup reports "Fewer than 3 core classes: add references to your dictionary Data Marts".
6. The Ontology Model tab lists the core classes with a checkbox each. A member can mark or unmark a class as core, between 0 and 5 in total, and the choice is saved in the shared model. Rebuild proposes a changed core set as a before / after row and never overrides a manual choice unless that row is checked.

Model additions:

```ts
interface ClassNode {
  // existing fields unchanged
  core: boolean;          // drawn around the goal in the ontology view
  inbound: number;        // inbound reference count at build time, shown in the tab
}
interface Model {
  // existing fields unchanged
  version: 3;
  editedBy: string | null;
}
```

A `version: 2` doc is upgraded on load. The upgrade computes `core` and `inbound` from the current schemas.

### 3.3 Other classes

Every other class with a primary key that connects to the goal or a core class stays in the model. These classes appear only in the flow view.

## 4. Ontology view (no date range)

1. It is the default view on every open.
2. The goal class card is in the center. Core class cards sit around it, at an equal distance, in rank order clockwise from the top.
3. Lines join each core class to the goal class and core classes to each other where a reference exists. An arrow points from the Data Mart that holds the reference to the one it references.
4. A card shows the class icon and the class name, large and centered. The goal card is larger than the core cards and has the blue border. No numbers, sparklines, badges, plan, forecast or status colours.
5. Context chips filter as today. The goal class is always shown.
6. No metric queries run and the cache is not read or refreshed. Refresh is hidden.

```
                ┌───────────┐
                │ CUSTOMERS │
                └─────┬─────┘
   ┌──────────┐ ┌─────┴─────┐ ┌──────────┐
   │ PRODUCTS ├─┤  REVENUE  ├─┤ VISITORS │
   └──────────┘ └─────┬─────┘ └──────────┘
                ┌─────┴─────┐
                │   USERS   │
                └───────────┘
```

## 5. Date range

1. The picker starts empty and reads "Select date range". No preset is chosen.
2. Choosing a range switches to the flow view. The picker gets a Clear action that empties the range and returns to the ontology view.
3. Comparison is available only with a range. Its default stays in Settings.
4. Settings, Default date range, gets the option "None (ontology view)" and it becomes the default. A member who prefers a preset can still choose one in their own preferences. A stored preference from 0.3 is ignored once, on the move to 0.4, so every member starts on the ontology view.
5. The chosen range is not remembered between opens unless the member set a default preset.

## 6. Flow view (date range chosen)

1. The goal class stays on top and its key metric is the critical number, as today.
2. The core classes form the next row, with their key metrics. A core class with no date field shows its Unique Count as a level: the count on the last day of the range, without a sparkline or forecast.
3. Below them come the classes connected to the goal or to core classes, one row per reference step, as in Gyroscope design 8.1.
4. Connectors show the direction a reference points. Their meaning stays "this class feeds that class", so the member can follow value from dictionary classes to the critical number.
5. Cards, badges, plan, forecast and statuses work as in Gyroscope design sections 7 and 8.2.

## 7. Cache

Cache doc ids stay `<preset>:<cmp|nocmp>` (or the custom window key). There is no cache doc for the ontology view. The model hash now includes `core` flags, so changing the core set refreshes the numbers.

## 8. Testing

| Layer | Test |
|---|---|
| Core class picking | Table-driven: ranking by inbound references, ties, no date field allowed, the goal mart excluded, fewer than 3, more than 5 |
| Shared model | Two fake members with different access read one doc and get the same classes and edges; the one without access gets lock cards in the flow view |
| Concurrent edit | A save over a newer doc stops with the "<name> changed the model" message |
| Upgrade | A `version: 2` member doc becomes a `version: 3` project doc with `core` set |
| Views | No range renders the ontology view with no queries; choosing a range runs queries; Clear returns to the ontology view |
| End to end | Two members of one project, with different Data Mart access, open the plugin and see the same canvas |

## Open questions

1. Migration. Which doc becomes the first shared model on 0.4? Options: the old project `model` doc, a fresh build on first open, or the member doc of whoever opens 0.4 first.
2. Schema access. Can the plugin read titles, primary keys and references of Data Marts the building member can't access? If `dataMarts.list` and the schema endpoints hide them, the build can't see the whole project and needs a platform change or a rule that only a project admin builds.
3. Core class connection. Must a core class reference the goal Data Mart directly, or does a path through another class count?
4. Who may edit the shared model: every member, or project admins only?
5. Should a core class without a date field show any number in the flow view (Unique Count as of the range end), or only its name?
