import type { ReactNode } from 'react';
import { safeHref } from '../lib/sanitizeHtml';

/**
 * Inline code, [links](url), **bold**, *italics* and bare URLs. Built as React nodes, never HTML,
 * so nothing in the text can become markup. Every span is capped in length, so text full of
 * unclosed marks costs linear time; an asterisk inside a word (price*qty) is not a mark; a URL
 * may hold balanced parentheses.
 */
const INLINE = /`([^`\n]{1,300})`|\[([^\]\n]{1,300})\]\(\s*((?:[^()\s]|\([^()\s]*\)){1,2000})\s*\)|\*\*(?!\s)(.{1,300}?)(?<!\s)\*\*|(?<![\w*])\*(?![\s*])([^*\n]{1,300}?)(?<!\s)\*(?![\w*])|(https?:\/\/(?:[^\s<>()]|\([^\s<>()]*\)){1,2000})/g;

/** Punctuation that ends a sentence rather than a bare URL. */
const TRAIL = /[.,;:!?'"]+$/;

function link(href: string, text: ReactNode, key: number): ReactNode {
  if (!safeHref(href)) return text;
  return <a key={key} href={href} target="_blank" rel="noopener noreferrer">{text}</a>;
}

/** `inLink` keeps a URL in a link's own label as text, so links never nest. */
function inline(text: string, inLink = false): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index;
    if (at > last) out.push(text.slice(last, at));
    const [, code, label, href, bold, em, url] = m;
    if (code !== undefined) out.push(<code key={at}>{code}</code>);
    else if (label !== undefined) out.push(inLink ? label : link(href!, inline(label, true), at));
    else if (bold !== undefined) out.push(<strong key={at}>{inline(bold, inLink)}</strong>);
    else if (em !== undefined) out.push(<em key={at}>{inline(em, inLink)}</em>);
    else {
      const bare = url!.replace(TRAIL, '');
      out.push(inLink ? bare : link(bare, bare, at), url!.slice(bare.length));
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const ITEM = /^\s*(?:[-*+]|(\d{1,9})[.)])\s+/;

type Segment = { kind: 'p'; lines: string[] } | { kind: 'list'; start: number | null; items: string[] };

/** A block's lines as paragraphs and lists: an indented line after an item continues it. */
function segments(lines: string[]): Segment[] {
  const out: Segment[] = [];
  for (const line of lines) {
    const cur = out[out.length - 1];
    const m = ITEM.exec(line);
    if (m) {
      const start = m[1] !== undefined ? Number(m[1]) : null;
      const item = line.slice(m[0].length);
      if (cur?.kind === 'list' && (cur.start === null) === (start === null)) cur.items.push(item);
      else out.push({ kind: 'list', start, items: [item] });
    } else if (cur?.kind === 'list' && /^\s/.test(line)) {
      cur.items[cur.items.length - 1] += ` ${line.trim()}`;
    } else if (cur?.kind === 'p') {
      cur.lines.push(line);
    } else {
      out.push({ kind: 'p', lines: [line] });
    }
  }
  return out;
}

/**
 * A description written in Markdown, rendered locally: paragraphs on blank lines, single line
 * breaks folded into spaces, bullet and numbered lists, and the inline marks above.
 */
export function MarkdownText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n\s*\n/).flatMap((b) => segments(b.split('\n')));
  return (
    <>
      {blocks.map((s, i) => s.kind === 'p'
        ? <p key={i}>{inline(s.lines.map((l) => l.trim()).join(' '))}</p>
        : s.start === null
          ? <ul key={i}>{s.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>
          : <ol key={i} start={s.start === 1 ? undefined : s.start}>{s.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ol>)}
    </>
  );
}
