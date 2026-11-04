import { useId, useState } from 'react';
import type { Option } from './FieldPicker';

export interface FieldGroup {
  martId: string;
  title: string;
  /** loading: the schema is still being read; unreadable: it couldn't be. */
  status: 'ok' | 'loading' | 'unreadable';
  options: Option[];
}

type Pick = { martId: string; field: string } | null;
const EXTRAPOLATED = '';
const keyOf = (p: Pick): string => (p ? `${p.martId}\n${p.field}` : EXTRAPOLATED);

/**
 * A combobox for the forecast source: "Extrapolated", then fields grouped by Data Mart. Typing filters by field
 * label, path or Data Mart title. Picking a field sets the Data Mart and the field at once.
 */
export function ForecastPicker({ martId, field, groups, missing, onOpen, onPick }: {
  /** The current source; null: extrapolated. */
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
  const [activeKey, setActiveKey] = useState(EXTRAPOLATED);

  const current = martId === null ? 'Extrapolated' : (() => {
    const g = groups.find((x) => x.martId === martId);
    const label = g?.options.find((o) => o.value === field)?.label ?? field;
    return `${g?.title ?? martId} › ${label}`;
  })();

  const filtered = (text: string) => {
    const q = text.trim().toLowerCase();
    return groups.map((g) => ({
      ...g,
      options: q === '' || g.title.toLowerCase().includes(q) ? g.options
        : g.options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)),
    })).filter((g) => g.options.length > 0 || (q === '' && g.status !== 'ok'));
  };
  const shown = filtered(query ?? '');
  const filtering = (query ?? '').trim() !== '';
  // the order the arrow keys walk: Extrapolated first, then each group's fields
  const flat: Pick[] = [null, ...shown.flatMap((g) => g.options.map((o) => ({ martId: g.martId, field: o.value })))];
  const keys = flat.map(keyOf);
  const active = Math.max(keys.indexOf(activeKey), 0);
  const optId = (i: number) => `${id}-o${i}`;

  const show = () => { if (!open) { setOpen(true); setActiveKey(keyOf(martId === null ? null : { martId, field })); onOpen(); } };
  const close = () => { setOpen(false); setQuery(null); };
  const pick = (p: Pick) => { onPick(p); close(); };
  const step = (d: number) => setActiveKey(keys[Math.min(Math.max(active + d, 0), keys.length - 1)] ?? EXTRAPOLATED);

  let i = 0;
  return (
    <span className="gy-combo">
      <input
        className={`gy-input gy-onto-pick${missing ? ' gy-bad' : ''}`} role="combobox" aria-label="Forecast source"
        aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-invalid={missing || undefined}
        aria-activedescendant={open ? optId(active) : undefined} title={missing ? `${current} no longer exists` : undefined}
        value={query ?? current} onClick={show} onBlur={close}
        onChange={(e) => {
          show();
          setQuery(e.target.value);
          // a filter highlights its first match, so Enter takes it rather than Extrapolated
          const first = filtered(e.target.value).flatMap((g) => g.options.map((o) => ({ martId: g.martId, field: o.value })))[0];
          setActiveKey(e.target.value.trim() !== '' && first ? keyOf(first) : EXTRAPOLATED);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); if (open) step(1); else show(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
          else if (e.key === 'Enter' && open) { e.preventDefault(); pick(flat[active] ?? null); }
          else if (e.key === 'Escape') close();
        }}
      />
      {open && (
        // mousedown would blur the input before the click lands
        <div id={`${id}-list`} role="listbox" aria-label="Forecast source" className="gy-combo-list" onMouseDown={(e) => e.preventDefault()}>
          <div id={optId(0)} role="option" aria-selected={martId === null} className={`gy-combo-opt${active === 0 ? ' gy-combo-active' : ''}`} onClick={() => pick(null)}>Extrapolated</div>
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
                    onMouseEnter={() => setActiveKey(keys[n] ?? EXTRAPOLATED)} onClick={() => pick({ martId: g.martId, field: o.value })}
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
