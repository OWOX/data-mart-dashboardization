import { useId, useState } from 'react';
import type { Option } from './FieldPicker';

export interface FieldGroup {
  martId: string;
  title: string;
  /** loading: the schema is still being read; unreadable: it couldn't be. */
  status: 'ok' | 'loading' | 'unreadable';
  options: Option[];
}

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
  onPick: (pick: { martId: string; field: string } | null) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const current = martId === null ? 'Extrapolated' : (() => {
    const g = groups.find((x) => x.martId === martId);
    const label = g?.options.find((o) => o.value === field)?.label ?? field;
    return `${g?.title ?? martId} › ${label}`;
  })();

  const q = (query ?? '').trim().toLowerCase();
  const shown = groups.map((g) => ({
    ...g,
    options: q === '' || g.title.toLowerCase().includes(q) ? g.options
      : g.options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)),
  })).filter((g) => g.options.length > 0 || (q === '' && g.status !== 'ok'));
  // the flat order the arrow keys walk: Extrapolated first, then each group's fields
  const flat: ({ martId: string; field: string } | null)[] = [null, ...shown.flatMap((g) => g.options.map((o) => ({ martId: g.martId, field: o.value })))];
  const optId = (i: number) => `${id}-o${i}`;

  const show = () => { if (!open) { setOpen(true); setActive(0); onOpen(); } };
  const close = () => { setOpen(false); setQuery(null); };
  const pick = (p: (typeof flat)[number]) => { onPick(p); close(); };

  let i = 0;
  return (
    <span className="gy-combo">
      <input
        className={`gy-input gy-onto-pick${missing ? ' gy-bad' : ''}`} role="combobox" aria-label="Forecast source"
        aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-invalid={missing || undefined}
        aria-activedescendant={open ? optId(active) : undefined} title={missing ? `${current} no longer exists` : undefined}
        value={query ?? current} onFocus={show} onClick={show} onBlur={close}
        onChange={(e) => { show(); setQuery(e.target.value); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); show(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
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
              {g.status === 'loading' && g.options.length === 0 && <div className="gy-combo-note">Loading…</div>}
              {g.status === 'unreadable' && <div className="gy-combo-note gy-bad-text">Couldn&apos;t read the schema</div>}
              {g.options.map((o) => {
                const n = ++i;
                return (
                  <div
                    key={o.value} id={optId(n)} role="option" aria-selected={martId === g.martId && field === o.value}
                    className={`gy-combo-opt${active === n ? ' gy-combo-active' : ''}`}
                    onMouseEnter={() => setActive(n)} onClick={() => pick({ martId: g.martId, field: o.value })}
                  >
                    {o.label}
                  </div>
                );
              })}
            </div>
          ))}
          {flat.length === 1 && q !== '' && <div className="gy-combo-note">No fields match</div>}
        </div>
      )}
    </span>
  );
}
