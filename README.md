# Gyroscope

Gyroscope is an OWOX Data Marts plugin that answers one question first: are we on track for the goal in the project description? It draws a canvas of business classes. The class that owns the goal sits on top, and below it sit the classes it depends on. Each card shows one key metric against plan, with a trend, and with a forecast when the date range ends in the future.

## Requirements in OWOX

1. The project description has a Metrics table with a Critical number row that links to a Data Mart field. That field is the goal.
2. An AI Credential is mapped when the plugin is installed. Gyroscope uses it to build the model of classes and metrics.
3. Calculated fields in your Data Marts reference other Data Marts. Gyroscope draws a connection for each reference.

## Develop

```bash
npm install
npm test
npm run typecheck
npm run build
```

The plugin platform does not support a local preview. Test Gyroscope as an installed plugin.

## Release

1. Push to `feat/data-mart-dashboards`. GitHub Pages deploys `dist/` to the folder of the compatibility line: `v3/` for 0.3.x. Installs of 0.2 keep loading the root.
2. A new compatibility line (0.4) needs `plugin.json` `delivery.url` moved to its folder (`/v4/`); a test fails until it is.
3. Check the plugin with `owox-ctl plugins check OWOX/gyroscope --ref feat/data-mart-dashboards`.
4. Create a release with `gh release create v0.3.0 --target <full commit SHA> --generate-notes`.
5. In OWOX, open Plugins, then Publish Plugin, and choose "Only me" for testing.

## How it works

The [design spec](docs/superpowers/specs/2026-10-24-gyroscope-design.md) has the details. Each step below maps to a section.

1. Build the ontology model: Gyroscope turns Data Marts, references and contexts into classes, connections and metrics, and picks the main class and key metrics (spec section 5).
2. Date ranges: presets, the fact window, the forecast window and the comparison window, all in UTC (section 6).
3. Metrics: one query per metric, a forecast, plan values and statuses (section 7).
4. Canvas and card: layout by reference distance, context filters, and the metric card (section 8).
5. States: blocked, failed and loading screens, each with a fix or a retry (section 9).
6. Cache: the canvas reads cached results, and a refresh runs when the data is stale (section 10).
