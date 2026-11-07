import { createBackend } from '@owox/plugin-sdk/server';
import { warmCache } from './warm';

// the page stays on GitHub Pages; this Worker only runs the scheduled cache refresh
export default createBackend({
  repositoryId: '1297672440',
  actions: { 'warm-cache': (input, ctx) => warmCache(input, { owox: ctx.owox, collections: (name) => ctx.collections(name), execution: ctx.execution }) },
});
