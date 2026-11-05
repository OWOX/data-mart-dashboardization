const KEEP = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'span']);
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'form', 'input', 'noscript', 'textarea', 'select', 'button', 'link', 'meta', 'base', 'frame', 'frameset', 'applet']);

/** True for http, https, mailto and relative links; false for javascript: and the like. */
export const safeHref = (v: string): boolean => {
  // browsers ignore tabs, newlines and other control characters inside a scheme
  const t = v.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(t);
  return scheme ? ['http', 'https', 'mailto'].includes(scheme[1]!) : true;
};

function clean(node: Element): void {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3) continue;
    if (child.nodeType !== 1) { child.remove(); continue; }
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP.has(tag)) { el.remove(); continue; }
    clean(el);
    if (!KEEP.has(tag)) { el.replaceWith(...el.childNodes); continue; }
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      const ok = (tag === 'a' && n === 'href' && safeHref(a.value))
        || ((tag === 'th' || tag === 'td') && (n === 'colspan' || n === 'rowspan' || n === 'align'));
      if (!ok) el.removeAttribute(a.name);
    }
    if (tag === 'a') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
  }
}

/** Defense in depth for HTML from OWOX's sanitizing endpoint: only the allowlisted elements and attributes survive; links open in a new tab. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  clean(doc.body);
  return doc.body.innerHTML;
}
