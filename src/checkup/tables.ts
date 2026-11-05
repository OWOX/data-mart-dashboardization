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
