import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/',
  plugins: [react()],
  // Serves the build for OWOX to embed; the router forwards gyroscope.dorland.keenetic.pro here.
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
    allowedHosts: ['gyroscope.dorland.keenetic.pro'],
    headers: { 'Access-Control-Allow-Origin': '*' },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['src/test-setup.ts'],
  },
});
