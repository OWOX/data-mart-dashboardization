# ODM plugin

The dashboard demo as an installable OWOX Data Marts plugin: dashboards are persisted in a
host-owned `dashboards` collection bound to the Data Mart they visualise, and every query goes
through the SDK client returned by `connect()`.

The production build is published at `/data-mart-dashboardization/odm-plugin/`, and `plugin.json`
points to that path. The Pages workflow updates only the `odm-plugin` directory and keeps the
existing site files.

## Local development

```bash
npm install
npm run dev              # http://localhost:5174 — @owox/plugin-sdk aliased to ui/sdk-mock.ts
OWOX_HOST=1 npm run dev  # real SDK handshake; use when the page is loaded through a running host
npm test                 # vitest run --maxWorkers=4
npm run typecheck        # tsc --noEmit
npm run css:check        # fails if the committed ui/styles.css is stale
```

**The port is 5174 and only 5174** (`strictPort`) — 5173 belongs to `odm-usage-stat`, and a host
install pins a fixed URL, so a second instance must fail loudly rather than drift to another port.

Plain `npm run dev` never talks to a host: it aliases `@owox/plugin-sdk` to
[`ui/sdk-mock.ts`](../ui/sdk-mock.ts), which serves two sample Data Marts, an in-memory collections
store (persisted to `localStorage`), and generated rows for every query shape the plugin compiles —
grouped, date-bucketed, ordered-then-limited, plus scorecard grand totals on the run. The sample
schema is deliberately shaped so `generate()` emits all five component types, and the numbers are
deterministic, so a reload redraws the same chart.

Set `OWOX_HOST=1` when the page is loaded *by* OWOX — otherwise the mock silently wins and you are
looking at sample data inside a real frame.

[`ui/local-dev.test.ts`](../ui/local-dev.test.ts) guards this loop: it runs the real
`listMarts → generate → compile → queryDataMart` path against the mock, so the offline experience
cannot rot unnoticed.

### Loading it in a real host

A plugin only runs inside the OWOX iframe and `delivery.url` must be public HTTPS — localhost is
rejected. The working loop is a stable public tunnel to the dev server: put the tunnel URL in
`plugin.json`, publish and install once, then edit locally and refresh the frame. The install pins
the URL, not the files, so code changes need no new release — only `plugin.json` changes do.

The dev server already binds the LAN (`server.host`) and sends `Access-Control-Allow-Origin: *`
(`server.cors`), because the iframe has an opaque origin and fetches even its own bundle
cross-origin. Vite rejects unknown `Host` headers, so name the tunnel when starting it:

```bash
OWOX_TUNNEL_HOST=data-mart-dashboards.example.keenetic.pro npm run dev
```

## Page surface

The host renders each page inside `SidebarInset` — `bg-background` + `rounded-xl` (`--radius` +
4px = **14px**) — and drops the plugin's iframe into it at `width:100%; height:100%`. The iframe
paints *on top of* that container, so **the plugin must not give itself an opaque page background**:
doing so repaints the host's rounded surface as a square and the corners visibly stop matching the
native pages (Models, Storages, Destinations). Those pages don't paint it either — `.dm-page` is
`min-height:100%` and nothing more; the inset behind them supplies the surface.

So `body` carries `text-foreground` only. Staying transparent inherits the host's exact corner
radius *and* surface color, in both themes, with no constant to keep in sync — which also means the
plugin must adopt `ctx.theme` ([`ui/main.tsx`](../ui/main.tsx)), or dark-mode text lands on the
host's dark surface while still styled for light. Standalone (`npm run dev`) there is nothing
behind the page, so `main.tsx` adds `.dm-standalone` to `<html>` when `window.self === window.top`
and that paints `--background`.

[`ui/styles.test.ts`](../ui/styles.test.ts) asserts the shipped `ui/styles.css` never paints
`html`, `body` or `#root` — that regression is invisible in unit tests and only shows up as
slightly-wrong corners inside the host.

Content is still wrapped in the OWOX chrome on every page, per the authoring guide:

```tsx
<div className="dm-page">
  <header className="dm-page-header"><h1 className="dm-page-header-title">Dashboards</h1></header>
  <div className="dm-page-content"><div className="dm-card">{/* content */}</div></div>
</div>
```

Locally, `http://localhost:5174/?theme=dark` makes the mock report the dark theme, which is the only
way to exercise the dark surface without a host.

### Editing styles

The host compiles plugin CSS with the default Tailwind theme and ignores `tailwind.config`, so
[`ui/styles.css`](../ui/styles.css) is **precompiled and committed**: `ui/styles.src.css` is the
source, `npm run css` compiles it, and `npm run dev`/`npm run build` run it for you. Commit the
regenerated file. Because `tailwind.config` scans `ui/**/*.{ts,tsx,html}`, a bare utility name used
as an identifier or in a comment leaks a real rule into the bundle — `npm run css:check` catches it.

## SDK release prerequisite

The plugin requires the fixed-group ODM release that adds `ctx.collections()` to
`@owox/plugin-sdk`. Until that release is published, the `0.30.1` package available from npm is the
older SDK and cannot run this plugin. After the ODM release:

1. update `@owox/plugin-sdk` to the released version;
2. refresh and commit `package-lock.json`;
3. run `npm run typecheck`, `npm test`, `npm run css:check`, and `npm run build`;
4. only then publish the feature-branch GitHub Pages build and create a strict-semver plugin release.

`npm run build` checks for the collections module and fails early if the old SDK is installed, so a
Pages deployment cannot silently bundle an incompatible runtime.
