# ODM plugin branch

This feature branch adapts the existing dashboard demo into an installable OWOX Data Marts plugin.
It does not replace the original demo from `main`.

The production build is published at `/data-mart-dashboardization/odm-plugin/`, and `plugin.json`
points to that branch-specific path. The Pages workflow updates only the `odm-plugin` directory and
keeps the existing site files.

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
