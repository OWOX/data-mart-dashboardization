/** Renders a Data Mart description to sanitized HTML through OWOX's own endpoint; results live in memory for the session. */
import { sanitizeHtml } from './sanitizeHtml';

export interface MarkdownHtml {
  /** The HTML already fetched for this mart's current description, if any. */
  peek(martId: string, markdown: string): string | undefined;
  /** Fetches and caches; null when the call fails (nothing is cached, so the next open tries again). */
  load(martId: string, markdown: string): Promise<string | null>;
}

export function createMarkdownHtml(parse: ((r: { markdown: string }) => Promise<string>) | undefined): MarkdownHtml | undefined {
  if (!parse) return undefined;
  const done = new Map<string, { markdown: string; html: string }>();
  const inflight = new Map<string, Promise<string | null>>();
  return {
    peek: (id, markdown) => { const h = done.get(id); return h && h.markdown === markdown ? h.html : undefined; },
    load(id, markdown) {
      const h = done.get(id);
      if (h && h.markdown === markdown) return Promise.resolve(h.html);
      const key = `${id}\u0000${markdown}`;
      const pending = inflight.get(key);
      if (pending) return pending;
      const p = Promise.resolve().then(() => parse({ markdown })).then(
        (html) => { if (typeof html !== 'string') return null; const safe = sanitizeHtml(html); done.set(id, { markdown, html: safe }); return safe; },
        () => null,
      ).finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
  };
}
