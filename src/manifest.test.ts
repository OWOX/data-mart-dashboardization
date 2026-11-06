import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => JSON.parse(readFileSync(join(__dirname, '..', f), 'utf8'));

// the deploy workflow publishes each compatibility line (0.x) to /v<x>/; the manifest must load from the same folder
test('the delivery URL is the folder of this compatibility line', () => {
  const minor = (read('package.json').version as string).split('.')[1];
  expect(read('plugin.json').delivery.url).toBe(`https://owox.github.io/gyroscope/v${minor}/`);
});

test('the backend runs the warm-cache action within the OWOX limit, and both cache collections are bound to the Data Mart', () => {
  const m = read('plugin.json');
  expect(m.backend.url).toMatch(/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/);
  expect(m.backend.actions['warm-cache'].timeoutSeconds).toBe(300);
  for (const name of ['mart-cache', 'schedule-models']) {
    expect(m.collections.find((c: { name: string }) => c.name === name)).toMatchObject({ scope: 'project', entityBinding: { type: 'data-mart' } });
  }
});
