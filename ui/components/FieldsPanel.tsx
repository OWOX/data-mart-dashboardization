import { useEffect, useMemo, useRef, useState } from 'react';
import { groupBySource, usedFields, type FieldGroups } from '../lib/fields';
import { fieldLabel } from '../lib/generate';
import { SidePanel } from './ui/SidePanel';
import { INPUT } from './ui/controls';
import { SearchIcon } from './ui/icons';
import type { Dashboard, MartField } from '../lib/types';

/** A selection settles before it is applied, so ticking five boxes is one refetch wave, not five. */
export const FIELDS_APPLY_DELAY_MS = 2000;

/**
 * The Fields picker, in the right-hand drawer.
 *
 * Layout mirrors what the fields mean: one block per Data Mart — the dashboard's own first, then
 * each joined source — and inside each, three columns for Date Ranges, Metrics and Dimensions. A
 * mart that joins sixty sources contributes hundreds of fields, so the search box filters across
 * every block and empty blocks drop out of the list entirely.
 *
 * A tick updates the checkbox at once and schedules the dashboard edit for `FIELDS_APPLY_DELAY_MS`
 * later; each further tick restarts that timer, so a burst of changes costs one round of queries.
 */
export function FieldsPanel({
  dashboard, fields, onApply, onClose,
}: {
  dashboard: Dashboard; fields: MartField[];
  onApply: (selected: Set<string>) => void; onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => usedFields(dashboard));
  const [query, setQuery] = useState('');
  // The applied baseline, so a settled selection identical to the dashboard schedules nothing.
  const appliedRef = useRef(selected);
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;

  useEffect(() => {
    if (sameSet(selected, appliedRef.current)) return;
    const timer = setTimeout(() => {
      appliedRef.current = selected;
      onApplyRef.current(selected);
    }, FIELDS_APPLY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [selected]);

  const needle = query.trim().toLowerCase();
  const sources = useMemo(() => {
    const matching = needle
      ? fields.filter(f => fieldLabel(f).toLowerCase().includes(needle) || f.name.toLowerCase().includes(needle))
      : fields;
    return groupBySource(matching, selected)
      .filter(s => s.groups.dates.length + s.groups.metrics.length + s.groups.dimensions.length > 0);
  }, [fields, needle, selected]);

  const toggle = (name: string) => setSelected(prev => {
    const next = new Set(prev);
    if (!next.delete(name)) next.add(name);
    return next;
  });

  const column = (title: string, list: MartField[]) => (
    <div className="min-w-0">
      <div className="mb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {list.length === 0
        ? <p className="px-1 text-xs text-muted-foreground">—</p>
        : (
          <ul className="space-y-0.5">
            {list.map(f => (
              <li key={f.name}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-accent">
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0"
                    checked={selected.has(f.name)}
                    onChange={() => toggle(f.name)}
                  />
                  <span className="min-w-0 break-words">{fieldLabel(f)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
    </div>
  );

  const block = (title: string, groups: FieldGroups, selectedCount: number, key: string) => (
    <section key={key} className="mb-5">
      <h3 className="mb-2 flex items-baseline gap-2 border-b pb-1 text-sm font-medium">
        <span className="min-w-0 truncate">{title}</span>
        {selectedCount > 0 && (
          <span className="shrink-0 text-xs font-normal text-muted-foreground">{selectedCount} in use</span>
        )}
      </h3>
      <div className="grid grid-cols-3 gap-3">
        {column('Date Ranges', groups.dates)}
        {column('Metrics', groups.metrics)}
        {column('Dimensions', groups.dimensions)}
      </div>
    </section>
  );

  return (
    <SidePanel
      title="Fields"
      description="Ticked fields are on the dashboard. Changes apply a couple of seconds after your last click."
      width="34rem"
      onClose={onClose}
    >
      <label className="mb-3 flex items-center gap-2">
        <SearchIcon className="shrink-0 text-muted-foreground" />
        <input
          type="search"
          className={INPUT}
          placeholder="Search fields"
          aria-label="Search fields"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </label>

      {fields.length === 0 && <p className="text-sm">No fields available for this Data Mart.</p>}
      {fields.length > 0 && sources.length === 0 && (
        <p className="text-sm">No fields match &ldquo;{query}&rdquo;.</p>
      )}
      {sources.map(s => block(s.title || 'This Data Mart', s.groups, s.selectedCount, s.aliasPath || 'own'))}
    </SidePanel>
  );
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every(v => b.has(v));
