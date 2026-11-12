import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => JSON.parse(readFileSync(join(__dirname, '..', f), 'utf8'));

// the deploy workflow publishes each compatibility line (0.x) to /v<x>/; the manifest must load from the same folder
test('the delivery URL is the folder of this compatibility line', () => {
  const minor = (read('package.json').version as string).split('.')[1];
  expect(read('plugin.json').delivery.url).toBe(`https://owox.github.io/gyroscope/v${minor}/`);
});

test('0.4 declares the shared ontology collection, project scope', () => {
  const cols = read('plugin.json').collections as { name: string; scope: string }[];
  expect(cols).toContainEqual({ name: 'ontology_project', scope: 'project' });
  expect(read('package.json').version).toBe('0.4.0');
});
