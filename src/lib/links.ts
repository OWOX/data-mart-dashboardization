export interface MartLink {
  index: number;
  source: 'project' | string;
  text: string;
  url: string;
  martId: string | null;
  field: string | null;
  placeholder: boolean;
}

// the label may hold escaped brackets: the ODM editor writes `[\[Plan\] Sales](…)` for a bracketed title
const LINK = /\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)\)/g;
const MART = /\/data-marts\/([^/?#]+)/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function extractLinks(markdown: string | null | undefined, source: 'project' | string, startIndex: number): MartLink[] {
  if (!markdown) return [];
  const out: MartLink[] = [];
  for (const m of markdown.matchAll(LINK)) {
    const url = m[2]!;
    const seg = MART.exec(url)?.[1];
    if (seg === undefined) continue;
    const query = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0]! : '';
    const field = new URLSearchParams(query).get('field');
    const martId = UUID.test(seg) ? seg.toLowerCase() : null;
    out.push({ index: startIndex + out.length, source, text: m[1]!.replace(/\\(.)/g, '$1').trim(), url, martId, field, placeholder: martId === null });
  }
  return out;
}
