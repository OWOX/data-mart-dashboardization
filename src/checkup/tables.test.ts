import { criticalRow, findMetricRows, isFieldLink } from './tables';

const ID = '11111111-2222-3333-4444-555555555555';
const PLAN = 'aaaaaaaa-2222-3333-4444-555555555555';
const link = (id: string, field: string, label = field) => `[${label}](https://app.owox.com/ui/p/data-marts/${id}/data-setup?field=${field})`;

test('reads the role, metric, plan and fact of each row', () => {
  const md = `# Goals\n\n## Metrics\n| Role | Metric | Owner | Plan | Fact |\n|---|---|---|---|---|\n| Critical number | ARR | Ann | ${link(PLAN, 'arr_plan')} | ${link(ID, 'arr')} |\n| Leading | Leads | Bo | | ${link(ID, 'leads')} |\n\nAfter.`;
  const rows = findMetricRows(md, 'project');
  expect(rows.map((r) => [r.role, r.metric, r.plan.length, r.fact.length])).toEqual([['Critical number', 'ARR', 1, 1], ['Leading', 'Leads', 0, 1]]);
  expect(rows[0]!.fact[0]).toMatchObject({ martId: ID, field: 'arr', source: 'project' });
  expect(criticalRow(rows)?.metric).toBe('ARR');
});

test('columns in any order and case; no Metric column takes the fact label', () => {
  const md = `fact | PLAN | role\n:--|--:|---\n${link(ID, 'rev', 'Revenue')} | | critical number`;
  const rows = findMetricRows(md, 'c1');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ role: 'critical number', metric: 'Revenue' });
  expect(rows[0]!.fact[0]!.source).toBe('c1');
});

test('a table without Role, Plan and Fact, or without a separator row, is not read', () => {
  expect(findMetricRows('| Role | Metric | Fact |\n|---|---|---|\n| Critical | A | x |', 'project')).toEqual([]);
  expect(findMetricRows('| Role | Plan | Fact |\n| Critical | | x |', 'project')).toEqual([]);
  expect(findMetricRows(null, 'project')).toEqual([]);
});

test('an escaped pipe stays inside its cell; two tables both count', () => {
  const md = `| Role | Metric | Plan | Fact |\n|-|-|-|-|\n| Critical | A \\| B | | ${link(ID, 'a')} |\n\n| Role | Plan | Fact |\n|-|-|-|\n| Lagging | | ${link(ID, 'b')} |`;
  const rows = findMetricRows(md, 'project');
  expect(rows.map((r) => r.metric)).toEqual(['A | B', 'b']);
});

test('isFieldLink rejects placeholders and links without a field', () => {
  const [ok] = findMetricRows(`| Role | Plan | Fact |\n|-|-|-|\n| Critical | | ${link(ID, 'a')} |`, 'project')[0]!.fact;
  expect(isFieldLink(ok!)).toBe(true);
  const [ph] = findMetricRows('| Role | Plan | Fact |\n|-|-|-|\n| Critical | | [X](https://app.owox.com/ui/p/data-marts/<id>/data-setup?field=a) |', 'project')[0]!.fact;
  expect(isFieldLink(ph!)).toBe(false);
  const [nofield] = findMetricRows(`| Role | Plan | Fact |\n|-|-|-|\n| Critical | | [X](https://app.owox.com/ui/p/data-marts/${ID}/data-setup) |`, 'project')[0]!.fact;
  expect(isFieldLink(nofield!)).toBe(false);
  expect(criticalRow([])).toBeNull();
});

import { setCriticalFact, setCriticalPlan, upsertMetricsTable } from './tables';

test('upsertMetricsTable replaces only the Metrics table', () => {
  const md = 'Intro.\n\n| Role | Metric | Plan | Fact |\n|---|---|---|---|\n| Critical number | Old | | |\n\nOutro.';
  const out = upsertMetricsTable(md, '| Role | Metric | Plan | Fact |\n|---|---|---|---|\n| Critical number | Revenue | | [Revenue](/ui/p/data-marts/o/data-setup?field=revenue) |');
  expect(out.startsWith('Intro.\n\n')).toBe(true);
  expect(out.endsWith('\n\nOutro.')).toBe(true);
  expect(out).toContain('| Critical number | Revenue |');
  expect(out).not.toContain('| Old |');
});

test('upsertMetricsTable appends when there is none', () => {
  expect(upsertMetricsTable('Just text.', 'T')).toBe('Just text.\n\nT');
  expect(upsertMetricsTable(null, 'T')).toBe('T');
  expect(upsertMetricsTable('  ', 'T')).toBe('T');
});

test('upsertMetricsTable ignores tables without Role, Plan and Fact', () => {
  const md = '| A | B |\n|---|---|\n| 1 | 2 |';
  expect(upsertMetricsTable(md, 'T')).toBe(`${md}\n\nT`);
});

const PH = '[Revenue](https://app.owox.com/ui/p/data-marts/<id>/data-setup?field=revenue)';
const DESC = `Intro.\n\n## Metrics\n| Role | Metric | Owner | Plan | Fact |\n|---|---|---|---|---|\n| Critical number | Revenue | Ann | ${link(PLAN, 'p')} | ${PH} |\n| Leading | Leads | Bo | | ${link(ID, 'leads')} |\n| Lagging | Churn | Cy | | ${link(ID, 'churn')} |\n\nOutro.`;

test('setCriticalFact changes only the Fact cell of the Critical row', () => {
  const out = setCriticalFact(DESC, 'Revenue', link(ID, 'rev', 'Revenue'));
  expect(out).toBe(DESC.replace(PH, link(ID, 'rev', 'Revenue')));
});

test('setCriticalFact fills an empty Metric cell and keeps a filled one', () => {
  const md = `| Role | Metric | Plan | Fact |\n|---|---|---|---|\n| Critical number | | | |`;
  expect(setCriticalFact(md, 'Sales', 'L')).toContain('| Critical number | Sales | | L |');
  expect(setCriticalFact(md.replace('| |', '| Mine |'), 'Sales', 'L')).toContain('| Critical number | Mine |');
});

test('setCriticalFact inserts a Critical row when the table has none', () => {
  const md = `Intro.\n\n| Role | Metric | Owner | Plan | Fact |\n|---|---|---|---|---|\n| Leading | Leads | Bo | | x |\n\nOutro.`;
  expect(setCriticalFact(md, 'Revenue', 'L')).toBe(`Intro.\n\n| Role | Metric | Owner | Plan | Fact |\n|---|---|---|---|---|\n| Critical number | Revenue | | | L |\n| Leading | Leads | Bo | | x |\n\nOutro.`);
});

test('setCriticalFact appends a table when there is none', () => {
  expect(setCriticalFact('Just text.', 'Revenue', 'L')).toBe('Just text.\n\n## Metrics\n| Role | Metric | Owner | Plan | Fact |\n|---|---|---|---|---|\n| Critical number | Revenue | | | L |');
  expect(setCriticalFact(null, 'R', 'L')).toBe('## Metrics\n| Role | Metric | Owner | Plan | Fact |\n|---|---|---|---|---|\n| Critical number | R | | | L |');
});

test('setCriticalPlan finds the Critical row in a later table and changes only its Plan cell', () => {
  const md = `| A | B |\n|---|---|\n| 1 | 2 |\n\n| Role | Plan | Fact |\n|---|---|---|\n| Leading | | f |\n\n| Role | Plan | Fact |\n|---|---|---|\n| Critical number | | g |\n\nEnd`;
  expect(setCriticalPlan(md, 'P')).toBe(md.replace('| Critical number | | g |', '| Critical number | P | g |'));
  expect(setCriticalPlan('| Role | Plan | Fact |\n|---|---|---|\n| Leading | | f |', 'P')).toBeNull();
  expect(setCriticalPlan('none', 'P')).toBeNull();
});
