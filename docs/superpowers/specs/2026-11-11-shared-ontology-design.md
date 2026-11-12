# Shared ontology and the ontology view: design

Date: 2026-11-11. Status: draft, all questions answered (2026-11-11). Ready for a plan.

Supersedes parts of three specs:

1. [Ontology Model](2026-11-04-ontology-model-design.md): storage per member, the seed cut to accessible Data Marts, risk 2, and the Ontology Model tab, which becomes the Metrics section of Checkup.
2. [Gyroscope design](2026-10-24-gyroscope-design.md): sections 5.3.3, 5.4.2 to 5.4.3, 6 (default range), 8.1, 8.2, 9 (no-access row) and 11 (default range).
3. [Checkup](2026-11-04-checkup-design.md): groups, statuses, and "fixing anything from the tab itself" being out of scope.

## Goal

Gyroscope presents the whole project ontology: the business classes and how they connect. Time series are optional. The member sees numbers only after choosing a date range, and then the canvas shows how value is generated and flows through the classes to the critical number.

## What the user asked for

1. The model is the same for every member of a project. Today two members of one project see different cards. That is a bug.
2. The default view is the ontology view. Its cards show the class name only: no numbers, no sparklines, no badges.
3. The goal class sits in the center. It is the class that owns the critical number, for example Revenue owning net profit.
4. Around it sit 3 to 7 core classes. Core classes are dictionary classes, such as Users, Customers, Visitors or Products, connected to each other and to the goal class.
5. A core class has a unique ID and as many inbound references as possible. It may have no date field.
6. The date range is empty by default. With no range, the canvas is the ontology view. This replaces "last quarter", "this quarter" and every other preset as the default.
7. Once a range is chosen, the canvas shows metrics on the goal and core classes, plus the classes connected to them, to show how value flows through the business.
8. Checkup becomes the setup page, for a new project and for an existing one. It has sections that are always visible, each with the worst status inside: blocker, warning or recommendation. It includes the Metrics tab.
9. Every check has an (i) tooltip saying what it is for. A check that isn't filled asks a question, suggests a recommended answer and applies it with one click.
10. Section 1 is the critical number from the project description. Its class is the goal class in the center.
11. Section 2 is the core classes. When none are set, Checkup suggests 3 to 7, depending on the project's industry.
12. Next come contexts, each context's critical number, and the rest of the existing checks.
13. The AI runs only to build a model from scratch and to suggest values for settings that aren't filled. The ontology and flow views never call it.
14. Only project admins edit the model. Members adjust their own view: filters, date ranges and their own settings.

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
2. Every member reads the same doc. Only a project admin writes it: Build, Rebuild, Apply selected, metric edits and Checkup's Apply. Each save sets `editedBy` and `editedAt`. Checkup shows "Last edited by <name>, <date>".
3. A save checks that the doc hasn't changed since it was read (`editedAt` or `builtAt`). If it has, the save stops and says "<name> changed the model at <time>. Reload to see their changes." Nothing is merged silently.
4. A member sees only the Data Marts they can access, and the platform doesn't change that. So a build or Rebuild sees only the builder's Data Marts. The shared doc protects what the builder can't see:
   1. Rebuild never removes a class, edge or metric whose Data Mart the builder can't access. The proposal lists them as "Kept: you can't access <title>".
   2. Rebuild adds what the builder can see and the doc lacks.
   3. Manual edits to a metric need access to its Data Mart. Without access, the row is read-only with "You can't access <title>".
   4. Checkup shows "Built by a member who couldn't access N Data Marts" as a recommendation, with the names of members who rebuilt it before.
5. On the move to 0.4, the old project `model` doc becomes the first shared doc, with no AI call. Edits members made to their own `ontology` docs in 0.3 are not carried over. Without a project `model` doc, the first admin to open 0.4 builds the shared doc. A member who opens a project with no shared doc sees "An admin hasn't set up Gyroscope yet" and a read-only Checkup.
6. The member-scoped `ontology` and project-scoped `model` collections stay in the manifest, read-only. The plugin stops writing them.
7. `cache` stays member-scoped. Numbers are still computed with each member's own access.
8. `seedFrom` and `withoutUndated` go. A class no longer needs a date field.

### Roles

A project admin is a member whose `GET /api/auth/context` roles include the project admin role. The first implementation task confirms the role's exact value.

| | Admin | Member |
|---|---|---|
| Build or Rebuild the model, edit metrics, mark core classes | Yes | No: read-only, "Only a project admin can change the model" |
| Checkup's Apply and the industry and core class settings | Yes | No: the suggestion shows read-only, with "Ask a project admin" |
| Plan threshold (project settings) | Yes | No |
| Context filters, date range, comparison | Yes | Yes |
| Own settings: default range, comparison default, week start | Yes | Yes, stored in `preferences` (member scope) |
| Run Checkup and read every result | Yes | Yes |

### AI calls

The AI runs only in two places, both started by an admin:

1. Building the model from scratch: the first build, and Rebuild, which builds a candidate from scratch and proposes the differences.
2. Suggesting a value for a setting that isn't filled, in Checkup, when the admin opens that question.

Opening the plugin, the ontology view, the flow view, a refresh and the migration to 0.4 never call the AI.

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

The industry and the core classes are stored in the plugin's project settings (`settings` collection, project scope, doc `project`), so they are the same for every member. Only an admin sets them, in Checkup. The project description is not edited for them.

```ts
interface Settings {
  // existing fields unchanged
  industry: Industry | null;               // section 8.2
  coreClasses: { martId: string; why: string }[] | null;  // 3 to 7; null: not set yet
}
```

Where the core classes come from:

1. The project description describes the business model: what the business sells, to whom, and through what. On the first build, the AI reads it and names the Data Marts that stand for those entities (customers, products, visitors). Only Data Marts with a single-column primary key qualify. These become `coreClasses`.
2. If the description names none, the build picks them by the ranking rules below, and Checkup reports a warning: "The project description doesn't describe the business model", with a drafted paragraph to add.
3. Later builds and Rebuilds add a core class the description newly names, up to 7. They never remove one: a core class stays in `coreClasses` and in the model when the description stops naming it. Only an admin unmarking it in Checkup removes it.
4. A change to `coreClasses` updates the `core` flags of the shared model without a rebuild and without the AI.

1. A candidate is a Data Mart with a single-column primary key. A date field is not required. The goal Data Mart is not a candidate.
2. A candidate must connect to the goal class directly: a calculated field of the goal Data Mart references it, or one of its calculated fields references the goal Data Mart.
3. Candidates are ranked by inbound references: the number of distinct Data Marts in the project whose calculated fields reference the candidate. Ties go to more connections with other candidates, then to the alphabetical title.
4. The number of core classes depends on `industry` (section 8.2), between 3 and 7. A candidate with no inbound references is never core.
5. With fewer than 3 candidates, the canvas shows those that exist, and Checkup reports a warning.

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
2. The goal class card is in the center. Its 3 to 7 core class cards sit around it, at an equal distance, in rank order clockwise from the top.
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
2. The core classes form the next row, with their key metrics. A core class with no date field shows its Unique Count: the number of rows with a distinct ID as of the end of the range, without a % diff, sparkline or forecast. Its label reads "<count> <Class>", for example "1,234 Customers".
3. Below them come the classes connected to the goal or to core classes, one row per reference step, as in Gyroscope design 8.1.
4. Connectors show the direction a reference points. Their meaning stays "this class feeds that class", so the member can follow value from dictionary classes to the critical number.
5. Cards, badges, plan, forecast and statuses work as in Gyroscope design sections 7 and 8.2.

## 7. Cache

Cache doc ids stay `<preset>:<cmp|nocmp>` (or the custom window key). There is no cache doc for the ontology view. The model hash now includes `core` flags, so changing the core set refreshes the numbers.

## 8. Checkup: setup and adjustment

Checkup is the one page where a project is set up from scratch or adjusted later. It replaces the Checkup and Ontology Model tabs. Settings keeps two tabs: General and Checkup. The route `/settings/checkup` stays; `/settings/ontology` opens Checkup at the Metrics section.

### 8.1 Behaviour

1. Six sections, always visible, in this order. A section that can't run yet, because an earlier blocker failed, shows its checks as skipped with "Fix <section> first".
2. Each check has one of four statuses:

   | Status | Meaning | Example |
   |---|---|---|
   | Blocker ✗ | Gyroscope doesn't work until it is fixed | No critical number |
   | Warning ⚠ | It works, with something important missing | No plan for the critical number |
   | Recommendation 💡 | It works; this makes it better | A context has no description |
   | Passed ✓ | Done | |

3. The section heading shows the worst status inside it and a count, for example "Core classes ⚠ 1 warning, 1 recommendation". The summary on top counts all sections. A new project opens with all sections expanded; a project with no blockers opens with only the sections that have warnings expanded.
4. Every check has an (i) icon. Its tooltip says what the check is for, in one or two sentences, for example "The critical number is the one number that says whether the business is on track. Gyroscope puts its class in the center and judges every other card by how it feeds it."
5. A check that isn't filled shows, under it:
   1. a question that finds the answer, for example "Which number tells you the business is on track?";
   2. a recommended answer, preselected, with up to 3 alternatives;
   3. an **Apply** button that writes the answer with one click, then reruns that section.
6. Apply is shown to admins only. Members see the question and the recommended answer read-only, with "Ask a project admin".
7. Apply writes one of: the plugin's project settings (industry, core classes, threshold), the shared model, the project description's Metrics table (`PUT /api/projects/settings/description`, replacing or appending only that table), a context (`POST /api/contexts`, `PUT /api/contexts/{id}`) or a Data Mart's contexts (`PUT /api/data-marts/{id}/contexts`).
8. If OWOX refuses a write, Apply turns into a copy-ready snippet and the existing Fix link to the OWOX page.
9. Recommended answers come from code when the schemas decide them (inbound references, primary keys, date fields) and from the AI when they need prose (industry, a metric's name, a context's description). An AI suggestion runs only when an admin opens a question that needs it, and its result is kept for the session. Members never trigger the AI.
10. Every Apply writes a line to the shared model's history: who, when, what. The (i) tooltip of a passed check shows "Applied by <name>, <date>" when Gyroscope wrote it.

### 8.2 Sections and checks

Existing checks keep their ids and logic. New checks are marked **new**.

**1. Critical number.** The number that says whether the business is on track, and its class, which sits in the center.

| Check | Status if not passing | Question and recommended answer |
|---|---|---|
| The project description isn't empty | Blocker | "What does the business sell, and to whom?" The AI drafts two sentences from Data Mart titles and descriptions |
| It has a Metrics table | Blocker | Applies the table with the Critical number row below |
| It has a Critical number row whose fact links a Data Mart field | Blocker | "Which number tells you the business is on track?" Recommended: the most referenced additive money field (SUM) of a Data Mart with a primary key and a date field, for example Revenue in Orders. Alternatives: the next 3 |
| Every Data Mart and field linked in the description exists | Blocker | Offers to relink each missing link to the field with the same name in another Data Mart, or to remove the row |
| Goal Data Mart: published, accessible, the field exists, primary key, date field | Blocker | No Apply: the Fix link opens the Data Mart. For a missing primary key, recommends the column whose values are unique in a preview |
| The Critical number's plan links a Data Mart field | Warning | "Where is the plan for <metric>?" Recommended: a field named like plan, target or budget in a Data Mart that shares the date field. Alternative: "No plan yet" |
| The plan's shape is known (daily, cumulative, level) **new** | Recommendation | Recommended from the plan values: cumulative when they only grow within a month |

**2. Core classes.** The 3 to 7 dictionary classes around the critical number: who buys, what is bought, where they come from.

| Check | Status if not passing | Question and recommended answer |
|---|---|---|
| The description describes the business model **new** | Warning | "What does the business sell, to whom, and through which channels?" The AI drafts a paragraph that names the core Data Marts. Apply appends it to the project description |
| The industry is set **new** | Warning | "Which business model is closest?" The AI reads the description and preselects one. Apply saves `industry` in the plugin settings |
| Core classes are set **new** | Warning | Applies the classes ranked by section 3.2, as many as the industry suggests (below), each with a one-line "Why it is core" from the AI. Apply saves `coreClasses` in the plugin settings |
| Each core class has a unique ID (a single-column primary key) **new** | Warning | Fix link to the Data Mart; recommends the column that is unique in a preview |
| Each core class connects directly to the goal class **new** | Warning | Names the calculated field to add, for example `customer_id` in Orders referencing Customers |
| Core classes connect to each other **new** | Recommendation | Lists the pairs with no reference where both share an ID column |
| The number of core classes fits the industry **new** | Recommendation | Suggests the next candidates by rank, or which ones to drop |
| A dictionary Data Mart with many inbound references isn't core **new** | Recommendation | "Add <title> as a core class? N Data Marts reference it." |

Core classes by industry, used for the count and as names to match against Data Mart titles:

| Industry | Count | Typical core classes |
|---|---|---|
| E-commerce, retail | 5 | Customers, Products, Sessions or Visitors, Campaigns, Stores or Channels |
| SaaS, subscriptions | 5 | Accounts, Users, Plans, Subscriptions, Campaigns |
| Marketplace | 6 | Buyers, Sellers, Listings, Categories, Sessions, Campaigns |
| Media, content | 4 | Users, Content items, Sessions, Advertisers |
| B2B services, agency | 4 | Clients, Contracts, Projects, Employees |
| Mobile apps, games | 4 | Users, Installs, Devices, Campaigns |
| Finance, lending | 5 | Customers, Accounts, Products, Applications, Channels |
| Other | 3 | The top 3 candidates by inbound references |

The ontology view takes as many core classes as `coreClasses` lists, from 3 to 7; the count above is only the suggestion.

**3. Contexts.** The teams or areas that move the critical number. Each one has its own critical number and plan.

| Check | Status if not passing | Question and recommended answer |
|---|---|---|
| At least two contexts exist | Warning | "Which teams move <critical number>?" Recommended by industry, for example Marketing, Sales and Product. Apply creates the contexts |
| Per context: the description isn't empty | Recommendation | The AI drafts it from the context's Data Marts |
| Per context: at least one Data Mart is in it | Warning | Recommended: the Data Marts whose titles or contexts match the name. Apply sets the Data Marts' contexts |
| Per context: it has a critical number row with a fact **new wording of the fact check** | Warning | "Which number shows <context> is doing its job?" Recommended: a leading metric whose Data Mart connects to the goal. Apply writes a Metrics table into the context description |
| Per context: the critical number has a plan | Recommendation | As for the project plan |
| Per context: every linked Data Mart and field exists | Blocker for that context's cards, shown as a warning | As in section 1 |

**4. Connections.** References between Data Marts, which draw the lines and order the cards.

| Check | Status if not passing | Question and recommended answer |
|---|---|---|
| The goal is reachable | Blocker | Fix link |
| Calculated fields reference other Data Marts | Warning | Names the ID columns shared by the goal and core classes, as candidate references |
| Each Data Mart with a fact link connects to the goal | Warning | As above, per Data Mart |
| Each Data Mart with a fact link has a primary key | Warning | Fix link; recommends a unique column |
| Each Data Mart with a fact link has a date field | Recommendation | Without one, it shows in the ontology view and gets no numbers in the flow view |

**5. Metrics.** The metrics of each class, which ones show, which one is key, and their plan and forecast sources. This is the former Ontology Model tab, with the same rows, draft, Save and Cancel, and Rebuild as a proposal.

| Check | Status if not passing | Question and recommended answer |
|---|---|---|
| The model is built | Blocker | Apply builds it, with the progress view |
| The saved model has no broken references | Warning | Per broken row: relink to the same field name, or drop |
| The saved model matches the descriptions | Warning | Apply opens Rebuild as a proposal |
| Each core class has a key metric **new** | Recommendation | Recommended: Unique Count of its ID |
| Each shown metric has a plan **new** | Recommendation | As for the project plan |

**6. Housekeeping.**

| Check | Status if not passing | Question and recommended answer |
|---|---|---|
| An AI credential is mapped | Blocker | Fix link to Plugins. Without it, suggestions that need the AI show only code-based answers |
| Who last changed the model, and with what access **new** | Recommendation | Shows the history from section 8.1 |

### 8.3 Code

1. `src/checkup/types.ts`: `CheckStatus` becomes `'running' | 'ok' | 'recommend' | 'warn' | 'fail' | 'skip'`; `GroupId` becomes `'critical' | 'core' | 'contexts' | 'connections' | 'metrics' | 'housekeeping'`; `Check` gains `purpose: string` (the tooltip) and `suggestion?: Suggestion`.
2. `Suggestion`: `{ question, options: { label, value, recommended }[], apply: ApplyTarget }`, where `ApplyTarget` is one of plugin settings, the shared model, the project Metrics table, context create or update, or Data Mart contexts.
3. `src/checkup/suggest.ts`: code-based suggestions. `src/checkup/suggestAi.ts`: AI suggestions, called lazily.
4. `src/checkup/apply.ts`: writes and the refusal fallback. `src/checkup/tables.ts` gains `upsertTable(markdown, heading, rows)`, which replaces only Gyroscope's table.
5. `OntologyTab` becomes the Metrics section inside `CheckupTab`.

## 9. Testing

| Layer | Test |
|---|---|
| Core classes from the description | First build takes the AI's picks from the description; a later build adds new ones and keeps those the description dropped; a pick without a single-column primary key is dropped |
| Core class picking | Table-driven: `coreClasses` from settings wins; without it, ranking by inbound references, ties, no date field allowed, the goal mart excluded, fewer than 3, more than 7 |
| Shared model | Two fake members with different access read one doc and get the same classes and edges; the one without access gets lock cards in the flow view |
| Concurrent edit | A save over a newer doc stops with the "<name> changed the model" message |
| Upgrade | The 0.3 project `model` doc becomes a `version: 3` shared doc with `core` set; a member's own 0.3 doc is ignored |
| Rebuild with less access | A builder without access to a class keeps that class, its edges and metrics |
| Roles | A member gets no Apply, no metric edits and no Rebuild; an admin gets all three; both change their own range and preferences |
| No AI in views | Opening the plugin, both views, refresh and the 0.4 migration make no AI call |
| Checkup | Each section's status is the worst inside it; every check has a tooltip; Apply writes the suggested value and reruns the section; a refused write shows the snippet |
| Views | No range renders the ontology view with no queries; choosing a range runs queries; Clear returns to the ontology view |
| End to end | Two members of one project, with different Data Mart access, open the plugin and see the same canvas |
