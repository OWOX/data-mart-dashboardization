import type { ReactNode } from 'react';
import { safeHref } from '../lib/sanitizeHtml';

/**
 * Inline code, [links](url), **bold**, *italics* and bare URLs. Built as React nodes, never HTML,
 * so nothing in the text can become markup.
 */
const INLINE = /`([^`]+)`|\[([^\]]+)\]\(\s*([^)\s]+)\s*\)|\*\*(.+?)\*\*|__(.+?)__|\*([^*\s][^*]*?)\*|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function link(href: string, text: ReactNode, key: number): ReactNode {
  if (!safeHref(href)) return text;
  return <a key={key} href={href}>{text}</a>;
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index;
    if (at > last) out.push(text.slice(last, at));
    const [, code, label, href, bold, bold2, em, url] = m;
    if (code !== undefined) out.push(<code key={at}>{code}</code>);
    else if (label !== undefined) out.push(link(href!, inline(label), at));
    else if (bold !== undefined || bold2 !== undefined) out.push(<strong key={at}>{inline(bold ?? bold2!)}</strong>);
    else if (em !== undefined) out.push(<em key={at}>{inline(em)}</em>);
    else out.push(link(url!, url, at));
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

/**
 * A description written in Markdown, rendered locally: paragraphs on blank lines, single line
 * breaks folded into spaces, bullet and numbered lists, and the inline marks above.
 */
export function MarkdownText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n\s*\n/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        if (lines.every((l) => ITEM.test(l))) {
          const Tag = /^\s*\d/.test(lines[0]!) ? 'ol' : 'ul';
          return <Tag key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(ITEM, ''))}</li>)}</Tag>;
        }
        return <p key={i}>{inline(lines.map((l) => l.trim()).join(' '))}</p>;
      })}
    </>
  );
}
