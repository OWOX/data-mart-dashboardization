// Guards the offline dev loop end to end: `npm run dev` aliases @owox/plugin-sdk to sdk-mock.ts,
// so if the mock drifts from what api.ts/generate.ts/compile.ts actually ask for, local development
// silently degrades to empty charts. The unit tests in sdk-mock.test.ts check the mock's contract;
// this one checks that the real plugin code gets usable data out of it.
import { describe, expect, it } from 'vitest';
import { getMartFields, listMarts, queryDataMart } from './lib/api';
import { compile } from './lib/compile';
import { generate, probeCardinality } from './lib/generate';

describe('local dev (sdk-mock) loop', () => {
  it('generates a dashboard from a sample mart and fills every component', async () => {
    const marts = await listMarts();
    expect(marts.length).toBeGreaterThan(0);

    const martId = marts[0].id;
    const fields = await getMartFields(martId);
    const cardinality = await probeCardinality(
      martId,
      fields.filter(f => f.role === 'dimension'),
    );
    const dashboard = generate(martId, marts[0].title, fields, cardinality);

    // The sample schema is shaped to exercise every renderer — a mock that only ever produced
    // pies (or only bars) would leave half the UI untestable offline.
    const types = new Set(dashboard.components.map(c => c.type));
    expect([...types].sort()).toEqual(['bar', 'pie', 'scorecard', 'table', 'timeseries']);

    for (const component of dashboard.components) {
      const result = await queryDataMart(
        martId,
        compile(component, dashboard.filters, dashboard.slices),
      );
      expect(result.columns.length).toBeGreaterThan(0);
      // A scorecard reads its number off the run's totals; every other component reads rows.
      if (component.type === 'scorecard') expect(result.totals).toBeTruthy();
      else expect(result.rows.length).toBeGreaterThan(0);
    }
  });
});
