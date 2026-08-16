// The host stacks this plugin's iframe on top of its own page container (`SidebarInset`, whose
// corner radius is 14px). Anything of ours that paints an opaque background across the whole page
// repaints that container as a square and visibly squares off the host's corners — the plugin then
// reads as "not a native page". Host-native pages don't paint it either; they let the inset show.
//
// The guard is on the COMPILED file because that is what actually ships: the host serves
// ui/styles.css verbatim and never re-runs Tailwind over our source.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Read from disk rather than `import ... ?raw`: vitest stubs CSS imports to an empty string, which
// would make every "does not contain a background" assertion below pass vacuously.
const css = readFileSync(join(process.cwd(), 'ui/styles.css'), 'utf8');

/** Declaration block of the LAST rule whose selector list contains exactly `selector`. */
function declarationsFor(selector: string): string {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m =>
    m[1]
      .split(',')
      .map((s: string) => s.trim())
      .includes(selector),
  );
  return rules.map(m => m[2]).join(';');
}

describe('shipped page surface', () => {
  it.each(['html', 'body', '#root'])(
    'leaves %s transparent so the host’s rounded page container shows through',
    selector => {
      expect(declarationsFor(selector)).not.toMatch(/(^|[;\s])background(-color)?\s*:/);
    },
  );

  it('paints a surface only when running standalone, outside a host frame', () => {
    expect(declarationsFor('.dm-standalone')).toMatch(/background-color:\s*var\(--background\)/);
  });
});
