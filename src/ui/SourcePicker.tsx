import { useEffect, useId, useRef, useState } from 'react';
import { useBelow } from './anchor';
import type { Option } from './FieldPicker';

export interface FieldGroup {
  martId: string;
  title: string;
  /** loading: the schema is still being read; unreadable: it couldn't be. */
  status: 'ok' | 'loading' | 'unreadable';
  options: Option[];
}

type Pick = { martId: string; field: string } | null;
const NO_SOURCE = '';
const keyOf = (p: Pick): string => (p ? `${p.martId}\n${p.field}` : NO_SOURCE);
// matches no option, so a filter with no match leaves nothing highlighted and Enter only closes
const NONE = '\n';

/** The words of a text: split on spaces, punctuation, `_`, `.`, `-` and lower→upper camel-case boundaries. */
const wordsOf = (s: string): string[] => s.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * A combobox for a source: a first option meaning none, then fields grouped by Data Mart. Typing filters by field
 * label, path or Data Mart title; each term of the query must start a word of one of them, so "book" doesn't match
 * "Facebook". Picking a field sets the Data Mart and the field at once.
 */
export function SourcePicker({ label, noneLabel, martId, field, groups, missing, onOpen, onPick }: {
  /** The accessible name of the box and its list. */
  label: string;
  /** The first option, which picks no source. */
  noneLabel: string;
  /** The current source; null: none. */
  martId: string | null; field: string;
  groups: FieldGroup[];
  /** The current source no longer exists: the input turns red. */
  missing: boolean;
  /** The list opened for the first time: the caller reads the schemas it still lacks. */
  onOpen: () => void;
  onPick: (pick: Pick) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  // the highlighted choice by key, so it stays put while schemas load and groups grow
  const [activeKey, setActiveKey] = useState(NO_SOURCE);

  const current = martId === null ? noneLabel : (() => {
    const g = groups.find((x) => x.martId === martId);
    const name = g?.options.find((o) => o.value === field)?.label ?? field;
    return name === '' ? (g?.title ?? martId) : `${g?.title ?? martId} › ${name}`;
  })();

  const filtered = (text: string) => {
    const terms = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return groups.map((g) => {
      const title = wordsOf(g.title);
      return {
        ...g,
        options: terms.length === 0 ? g.options : g.options.filter((o) => {
          const words = [...title, ...wordsOf(o.label), ...wordsOf(o.value)];
          return terms.every((t) => words.some((w) => w.startsWith(t)));
        }),
      };
    }).filter((g) => g.options.length > 0 || (terms.length === 0 && g.status !== 'ok'));
  };
  const shown = filtered(query ?? '');
  const filtering = (query ?? '').trim() !== '';
  // the order the arrow keys walk: the none option first, then each group's fields
  const flat: Pick[] = [null, ...shown.flatMap((g) => g.options.map((o) => ({ martId: g.martId, field: o.value })))];
  const keys = flat.map(keyOf);
  // -1: the current choice isn't listed (its schema is loading, or it no longer exists); Enter then changes nothing
  const active = keys.indexOf(activeKey);
  const anchor = useRef<HTMLInputElement>(null);
  const style = useBelow(anchor, open);
  // the arrow keys keep the highlighted option in view inside the scrolling list
  // only for the keyboard: scrolling under a hovering pointer would move the next option beneath it
  const byKeys = useRef(false);
  useEffect(() => { if (open && active >= 0 && byKeys.current) document.getElementById(`${id}-o${active}`)?.scrollIntoView?.({ block: 'nearest' }); }, [open, active, id]);
  const optId = (i: number) => `${id}-o${i}`;

  const show = () => { if (!open) { setOpen(true); setActiveKey(keyOf(martId === null ? null : { martId, field })); onOpen(); } };
  const close = () => { setOpen(false); setQuery(null); };
  const pick = (p: Pick) => { onPick(p); close(); };
  const step = (d: number) => { byKeys.current = true; setActiveKey(keys[Math.min(Math.max(active + d, 0), keys.length - 1)] ?? NO_SOURCE); };

  let i = 0;
  return (
    <span className="gy-combo">
      <input
        ref={anchor} className={`gy-input gy-onto-pick${missing ? ' gy-bad' : ''}`} role="combobox" aria-label={label}
        aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-invalid={missing || undefined}
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined} title={missing ? `${current} no longer exists` : undefined}
        value={query ?? current} onClick={show} onBlur={close}
        onChange={(e) => {
          show();
          setQuery(e.target.value);
          // a filter highlights its first match, so Enter takes it rather than the none option
          const first = filtered(e.target.value).flatMap((g) => g.options.map((o) => ({ martId: g.martId, field: o.value })))[0];
          setActiveKey(e.target.value.trim() === '' ? NO_SOURCE : first ? keyOf(first) : NONE);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); if (open) step(1); else show(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
          else if (e.key === 'Enter' && open) { e.preventDefault(); if (active >= 0) pick(flat[active] ?? null); else close(); }
          else if (e.key === 'Escape') close();
        }}
      />
      {open && (
        // mousedown would blur the input before the click lands
        <div id={`${id}-list`} role="listbox" aria-label={label} className="gy-combo-list" style={style} onMouseDown={(e) => e.preventDefault()}>
          <div id={optId(0)} role="option" aria-selected={martId === null} className={`gy-combo-opt${active === 0 ? ' gy-combo-active' : ''}`} onClick={() => pick(null)}>{noneLabel}</div>
          {shown.map((g) => (
            <div key={g.martId} role="group" aria-label={g.title}>
              <div className="gy-combo-head" aria-hidden="true">{g.title}</div>
              {g.status === 'loading' && g.options.length === 0 && <div role="option" aria-selected={false} aria-disabled="true" className="gy-combo-note">Loading…</div>}
              {g.status === 'unreadable' && <div role="option" aria-selected={false} aria-disabled="true" className="gy-combo-note gy-bad-text">Couldn&apos;t read the schema</div>}
              {g.options.map((o) => {
                const n = ++i;
                return (
                  <div
                    key={o.value} id={optId(n)} role="option" aria-selected={martId === g.martId && field === o.value}
                    className={`gy-combo-opt${active === n ? ' gy-combo-active' : ''}`}
                    onMouseEnter={() => { byKeys.current = false; setActiveKey(keys[n] ?? NO_SOURCE); }} onClick={() => pick({ martId: g.martId, field: o.value })}
                  >
                    {o.label}
                  </div>
                );
              })}
            </div>
          ))}
          {flat.length === 1 && filtering && <div role="option" aria-selected={false} aria-disabled="true" className="gy-combo-note">No fields match</div>}
        </div>
      )}
    </span>
  );
}
