import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative, so the same build works at a domain root and under /gyroscope/ on GitHub Pages.
  base: './',
  plugins: [react()],
  // Local preview; the router forwards gyroscope.dorland.keenetic.pro here.
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
