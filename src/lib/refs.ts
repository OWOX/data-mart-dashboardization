export interface FormulaRef { path: string; field: string }

const TAG = /\{\{\s*ref\s+([^}]*)\}\}/g;
const ATTR = /(path|field)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseRefs(formula: string): FormulaRef[] {
  const out: FormulaRef[] = [];
  for (const tag of formula.matchAll(TAG)) {
    const attrs: Record<string, string> = {};
    for (const a of (tag[1] ?? '').matchAll(ATTR)) attrs[a[1]!] = a[2] ?? a[3] ?? '';
    if (attrs.field) out.push({ path: attrs.path ?? '', field: attrs.field });
  }
  return out;
}
