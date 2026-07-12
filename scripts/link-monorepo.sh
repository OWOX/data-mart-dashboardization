#!/usr/bin/env bash
# LOCAL dev helper (gitignored — hardcodes a machine path, not for the published repo).
# Bridges this standalone plugin to the OWOX monorepo so `npm run dev:broker` works from here:
# it symlinks the unpublished `@owox/plugin-sdk` and the `owox-plugin-dev` runner into this repo's
# (gitignored) node_modules. Re-run after `npm ci` / wiping node_modules.
#
# Usage:  ./scripts/link-monorepo.sh          (uses the default path below)
#         OWOX_MONOREPO=/path/to/mono ./scripts/link-monorepo.sh
set -euo pipefail
MONO="${OWOX_MONOREPO:-/Users/flakss/Projects/owox-data-marts-experimental}"
[ -d "$MONO/packages/plugin-sdk" ] || { echo "OWOX monorepo not found at: $MONO (set OWOX_MONOREPO)"; exit 1; }

cd "$(dirname "$0")/.."
mkdir -p node_modules/@owox node_modules/.bin
ln -sfn "$MONO/packages/plugin-sdk" node_modules/@owox/plugin-sdk
ln -sfn "$MONO/node_modules/.bin/owox-plugin-dev" node_modules/.bin/owox-plugin-dev
echo "Linked @owox/plugin-sdk + owox-plugin-dev from $MONO"
echo "Now: npm run dev:broker  → http://localhost:5177/"
