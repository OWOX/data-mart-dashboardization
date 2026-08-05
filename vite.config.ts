import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  root: 'ui',
  // This branch is published next to the existing demo, not over it.
  base: command === 'build' ? '/data-mart-dashboardization/odm-plugin/' : '/',
  // `npm run dev` (serve): resolve @owox/plugin-sdk to the local mock so the UI runs in the browser
  // with no host. Production bundles the real SDK because an opaque-origin iframe cannot import
  // host-provided modules or rely on an import map owned by the parent document.
  resolve:
    command === 'serve'
      ? {
          preserveSymlinks: true,
          alias: { '@owox/plugin-sdk': fileURLToPath(new URL('./ui/sdk-mock.ts', import.meta.url)) },
        }
      : {
          // Keep optional workspace-linked packages rooted in this node_modules tree so a linked
          // plugin SDK resolves the matching @owox/api-client rather than another checkout.
          preserveSymlinks: true,
        },
  build: {
    outDir: '../dist/odm-plugin',
    emptyOutDir: true,
  },
}));
