import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// 5174 is this plugin's pinned port — odm-usage-stat owns 5173, and any tunnel/host install points
// at a fixed number. strictPort makes a second instance fail loudly instead of drifting to 5175.
const PORT = 5174;
// Set when the dev server is reached through a public tunnel (the only way OWOX can load it:
// delivery.url must be public HTTPS, localhost is rejected). e.g.
// OWOX_TUNNEL_HOST=data-mart-dashboards.example.keenetic.pro npm run dev
const TUNNEL_HOST = process.env.OWOX_TUNNEL_HOST;

export default defineConfig(({ command }) => ({
  plugins: [react()],
  root: 'ui',
  // This branch is published next to the existing demo, not over it.
  base: command === 'build' ? '/data-mart-dashboardization/odm-plugin/' : '/',
  // `npm run dev` (serve): resolve @owox/plugin-sdk to the local mock so the UI runs in the browser
  // with no host. OWOX_HOST=1 keeps the real SDK during serve — use it when the page is loaded *by*
  // OWOX through the tunnel, or the mock silently wins and you debug sample data in a real frame.
  // Production always bundles the real SDK because an opaque-origin iframe cannot import
  // host-provided modules or rely on an import map owned by the parent document.
  resolve:
    command === 'serve' && !process.env.OWOX_HOST
      ? {
          preserveSymlinks: true,
          alias: { '@owox/plugin-sdk': fileURLToPath(new URL('./ui/sdk-mock.ts', import.meta.url)) },
        }
      : {
          // Keep optional workspace-linked packages rooted in this node_modules tree so a linked
          // plugin SDK resolves the matching @owox/api-client rather than another checkout.
          preserveSymlinks: true,
        },
  // host/cors: the plugin iframe has an opaque origin, so even its own bundle is fetched
  // cross-origin, and the tunnel forwards from the LAN.
  server: {
    port: PORT,
    strictPort: true,
    host: true,
    cors: true,
    ...(TUNNEL_HOST ? { allowedHosts: [TUNNEL_HOST] } : {}),
  },
  preview: { port: PORT, strictPort: true },
  build: {
    outDir: '../dist/odm-plugin',
    emptyOutDir: true,
  },
}));
