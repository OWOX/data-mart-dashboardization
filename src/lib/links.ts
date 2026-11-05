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

/** Hosts that serve the OWOX app: owox.com and its subdomains, plus the page this plugin is framed in (a self-hosted install). */
export const owoxHosts = (ancestors: readonly string[] = []): string[] =>
  ancestors.flatMap((o) => { try { return [new URL(o).host]; } catch { return []; } });

/**
 * The app path a link points at (/ui/...), when it is a page of the OWOX app, so the host can open
 * it in place; null for any other link.
 */
export function owoxPath(href: string, hosts: readonly string[]): string | null {
  let url: URL;
  try { url = new URL(href, 'https://relative.invalid'); } catch { return null; }
  const relative = url.host === 'relative.invalid' && href.startsWith('/');
  const owox = /^https?:$/.test(url.protocol) && (url.hostname === 'owox.com' || url.hostname.endsWith('.owox.com') || hosts.includes(url.host));
  if (!relative && !owox) return null;
  return url.pathname.startsWith('/ui/') ? `${url.pathname}${url.search}${url.hash}` : null;
}
