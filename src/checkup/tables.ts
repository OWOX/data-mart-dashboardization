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

interface Located { lines: string[]; starts: number[]; role: number; plan: number; fact: number; metric: number }

// every table with Role, Plan and Fact columns; `starts[i]` is the offset of lines[i] (without a trailing \r) in the text
function locateMetricsTables(markdown: string): Located[] {
  const raw = markdown.split('\n');
  const starts: number[] = [];
  let pos = 0;
  for (const l of raw) { starts.push(pos); pos += l.length + 1; }
  const lines = raw.map((l) => l.replace(/\r$/, ''));
  const out: Located[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i]!.includes('|') || !isSeparator(lines[i + 1]!)) continue;
    const head = cells(lines[i]!).map((c) => c.toLowerCase());
    const [role, plan, fact, metric] = ['role', 'plan', 'fact', 'metric'].map((n) => head.indexOf(n)) as [number, number, number, number];
    const leading = lines[i]!.trim().startsWith('|');
    let last = i + 1;
    while (last + 1 < lines.length && isRow(lines[last + 1]!, leading)) last++;
    if (role >= 0 && plan >= 0 && fact >= 0) out.push({ lines: lines.slice(i, last + 1), starts: starts.slice(i, last + 1), role, plan, fact, metric });
    i = last;
  }
  return out;
}
const rowText = (c: string[]) => `|${c.map((x) => (x ? ` ${x.replace(/\|/g, '\\|')} ` : ' ')).join('|')}|`;
const eolOf = (md: string) => (md.includes('\r\n') ? '\r\n' : '\n');

// swaps one body row's cells in place; nothing else in the text moves
function editCritical(markdown: string, edit: (row: string[], t: Located) => void): string | null {
  for (const t of locateMetricsTables(markdown)) {
    const i = t.lines.findIndex((l, n) => n >= 2 && /critical/i.test(cells(l)[t.role] ?? ''));
    if (i < 0) continue;
    const row = cells(t.lines[i]!);
    while (row.length <= Math.max(t.plan, t.fact)) row.push('');
    edit(row, t);
    return markdown.slice(0, t.starts[i]!) + rowText(row) + markdown.slice(t.starts[i]! + t.lines[i]!.length);
  }
  return null;
}

/** The Fact cell of the Critical number row (and its Metric cell when empty). No such row: inserts one as the first body row of the first Metrics table, or appends a new table. */
export function setCriticalFact(markdown: string | null, metric: string, factLink: string): string {
  const md = markdown ?? '';
  const edited = editCritical(md, (row, t) => { row[t.fact] = factLink; if (t.metric >= 0 && !row[t.metric]) row[t.metric] = metric; });
  if (edited !== null) return edited;
  const first = locateMetricsTables(md)[0];
  if (first) {
    const row = Array.from({ length: cells(first.lines[0]!).length }, () => '');
    row[first.role] = 'Critical number'; row[first.fact] = factLink;
    if (first.metric >= 0) row[first.metric] = metric;
    const at = first.starts[1]! + first.lines[1]!.length;
    return md.slice(0, at) + eolOf(md) + rowText(row) + md.slice(at);
  }
  const table = `## Metrics\n| Role | Metric | Owner | Plan | Fact |\n|---|---|---|---|---|\n| Critical number | ${metric.replace(/\|/g, '\\|')} | | | ${factLink} |`;
  return md.trim() ? `${md}\n\n${table}` : table;
}

/** Sets only the Plan cell of the Critical number row, in whichever Metrics table has one; null when there is no such row. */
export const setCriticalPlan = (markdown: string | null, planLink: string): string | null =>
  markdown ? editCritical(markdown, (row, t) => { row[t.plan] = planLink; }) : null;
