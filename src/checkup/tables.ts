import { extractLinks, type MartLink } from '../lib/links';

export interface MetricRow { role: string; metric: string; plan: MartLink[]; fact: MartLink[] }

// splits a table line into cells; `\|` stays inside its cell
const cells = (line: string): string[] => {
  const t = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
};
const isSeparator = (line: string) => /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(line.trim());
// body rows follow the header's style: with a leading pipe every row starts with one, without it any non-blank row holding a pipe counts
const isRow = (line: string, leading: boolean) => (leading ? line.trim().startsWith('|') : line.includes('|') && line.trim() !== '');

/** Every body row of every Metrics table in the Markdown, in order. */
export function findMetricRows(markdown: string | null | undefined, source: 'project' | string): MetricRow[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const out: MetricRow[] = [];
  let i = 0;
  while (i + 1 < lines.length) {
    if (!lines[i]!.includes('|') || !isSeparator(lines[i + 1]!)) { i++; continue; }
    const leading = lines[i]!.trim().startsWith('|');
    const head = cells(lines[i]!).map((c) => c.toLowerCase());
    const [role, plan, fact, metric] = ['role', 'plan', 'fact', 'metric'].map((n) => head.indexOf(n)) as [number, number, number, number];
    i += 2;
    const isMetrics = role >= 0 && plan >= 0 && fact >= 0;
    while (i < lines.length && isRow(lines[i]!, leading)) {
      if (isMetrics) {
        const row = cells(lines[i]!);
        const factLinks = extractLinks(row[fact] ?? '', source, 0);
        out.push({
          role: row[role] ?? '',
          metric: (metric >= 0 ? row[metric] : undefined) || factLinks[0]?.text || '',
          plan: extractLinks(row[plan] ?? '', source, 0),
          fact: factLinks,
        });
      }
      i++;
    }
  }
  return out;
}

/** The first row whose role contains "critical", any case. */
export const criticalRow = (rows: MetricRow[]): MetricRow | null => rows.find((r) => /critical/i.test(r.role)) ?? null;
/** A link that names a real Data Mart field: not a placeholder, with a Data Mart id and a field. */
export const isFieldLink = (l: MartLink): boolean => !l.placeholder && !!l.martId && !!l.field;

interface Located { start: number; end: number; lines: string[]; role: number; plan: number }

// the first table with Role, Plan and Fact columns; start and end are character offsets (end excludes the last line's break)
function locateMetricsTable(markdown: string): Located | null {
  const lines = markdown.split('\n');
  let pos = 0;
  const offsets = lines.map((l) => { const o = pos; pos += l.length + 1; return o; });
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i]!.includes('|') || !isSeparator(lines[i + 1]!)) continue;
    const head = cells(lines[i]!).map((c) => c.toLowerCase());
    const [role, plan, fact] = ['role', 'plan', 'fact'].map((n) => head.indexOf(n)) as [number, number, number];
    if (role < 0 || plan < 0 || fact < 0) continue;
    const leading = lines[i]!.trim().startsWith('|');
    let last = i + 1;
    while (last + 1 < lines.length && isRow(lines[last + 1]!, leading)) last++;
    const end = offsets[last]! + lines[last]!.replace(/\r$/, '').length;
    return { start: offsets[i]!, end, lines: lines.slice(i, last + 1).map((l) => l.replace(/\r$/, '')), role, plan };
  }
  return null;
}

/** Replaces the first Metrics table in the description, or appends one; the rest of the text stays byte for byte. */
export function upsertMetricsTable(markdown: string | null, table: string): string {
  const headed = table.startsWith('|') ? `## Metrics\n${table}` : table;
  if (!markdown?.trim()) return headed;
  const at = locateMetricsTable(markdown);
  return at ? markdown.slice(0, at.start) + table + markdown.slice(at.end) : `${markdown}\n\n${headed}`;
}

/** The first Metrics table with the plan cell of its Critical number row set to `planCell`; null without such a row. */
export function withCriticalPlan(markdown: string | null, planCell: string): string | null {
  const at = markdown ? locateMetricsTable(markdown) : null;
  if (!at) return null;
  const i = at.lines.findIndex((l, n) => n >= 2 && /critical/i.test(cells(l)[at.role] ?? ''));
  if (i < 0) return null;
  const row = cells(at.lines[i]!);
  while (row.length <= at.plan) row.push('');
  row[at.plan] = planCell;
  const lines = [...at.lines];
  lines[i] = `| ${row.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`;
  return lines.join('\n');
}
