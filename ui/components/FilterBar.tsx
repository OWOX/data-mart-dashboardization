import { describeFilter, RELATIVE_PRESETS } from '../lib/filterOps';
import { columnLabel, isDate } from '../lib/generate';
import type { Dashboard, FilterRule, MartField } from '../lib/types';

type RelativeValue = { kind: string; n?: number };

const DEFAULT_PRESET: RelativeValue = { kind: 'last_n_days', n: 30 };

/** The "no range on this field" option. Not an operator — selecting it drops the slice entirely. */
const ALL_TIME = '';

/**
 * Every slice is a `relative_date` pre-join filter (that's the only operator `generate.ts` ever
 * emits for a date field). Defensive parse, in the same spirit as `compile.ts`'s `dir()`/`clamp()`:
 * a hand-edited or older-schema doc's `value` isn't provably shaped at runtime even though the
 * type says so, so fall back to the first preset rather than crashing the control.
 */
function presetValue(v: unknown): RelativeValue {
  const obj = v as { kind?: unknown; n?: unknown } | null | undefined;
  const kind =
    typeof obj?.kind === 'string' && RELATIVE_PRESETS.some(p => p.kind === obj.kind)
      ? obj.kind
      : RELATIVE_PRESETS[0].kind;
  const n = typeof obj?.n === 'number' ? obj.n : undefined;
  return { kind, n };
}

const needsN = (kind: string): boolean => RELATIVE_PRESETS.find(p => p.kind === kind)?.needsN ?? false;

/**
 * Global filter controls: one per date slice, in a single wrapping row, each labelled with the
 * mart field (column) it controls. Operators come ONLY from `filterOps.ts` (`RELATIVE_PRESETS`) —
 * never hand-rolled, so a rejected operator (`this_week`, `in_next_n_days`, ...) can never reach
 * the wire. Changing a control reports the FULL updated `filters`/`slices` pair to `onChange`;
 * `DashboardView` bumps `configVersion` from there, which refetches every component.
 *
 * Cross-filtering (Task 16; ephemeral as of Task 20/M7): `filters` is the EFFECTIVE, display-only
 * view `DashboardView` computes — persisted `dashboard.filters` merged with any active ephemeral
 * cross-filter set by clicking a bar/pie segment (see `DashboardView`'s `onSegmentFilter` and
 * `effectiveDashboard`). This bar must render whenever EITHER `dashboard.slices` OR the `filters`
 * PROP is non-empty — a dashboard with no date fields (no slices) but an active cross-filter must
 * still show a way to see/clear it, or the filter is invisible and stuck on (the "worst possible
 * outcome" this plugin explicitly guards against: a filtered dashboard that looks unfiltered).
 * "Reset filters" no longer computes anything itself — `FilterBar` has no way to reach the
 * ephemeral `crossFilters` state that lives in `DashboardView`, so the button just calls the
 * `onResetAll` prop, which is `DashboardView`'s job to implement (clearing BOTH the persisted
 * `dashboard.filters`, via `ui/lib/edit.ts`'s unchanged Dashboard-level `resetFilters`, AND the
 * ephemeral cross-filter array).
 */
export function FilterBar({
  dashboard,
  fields,
  filters,
  onChange,
  onResetAll,
}: {
  /** The REAL dashboard — used only for `slices` (the date controls). */
  dashboard: Dashboard;
  /** The mart's schema: every date field gets a control, whether or not it currently filters. */
  fields: MartField[];
  /** The EFFECTIVE filters (persisted + ephemeral cross-filters), for display only. */
  filters: FilterRule[];
  /** Slice edits only — unchanged signature, always passes through the real `dashboard.filters`. */
  onChange: (filters: FilterRule[], slices: FilterRule[]) => void;
  /** Clears BOTH the persisted filters and the ephemeral cross-filters. */
  onResetAll: () => void;
}) {
  const { slices } = dashboard;
  // A control per date field ON the dashboard — i.e. one per slice — not per date field in the
  // mart. The Fields panel is the single source of truth for what is on the dashboard, so ticking
  // a date field there is what adds its control here, and "All time" removes it again. Showing all
  // eight of a mart's date columns while only one filters is exactly the mismatch this avoids;
  // ANDing all eight at 30 days matches nothing anyway (measured: 95,986 rows → 0).
  const columns = slices.map(s => s.column);
  if (columns.length === 0 && filters.length === 0) return null;

  const setRange = (column: string, value: RelativeValue | null) => {
    const without = slices.filter(s => s.column !== column);
    const next = value === null
      ? without
      : [...without, { column, operator: 'relative_date', value }];
    // Keep the document's slice order stable, so controls don't jump as ranges are set and cleared.
    next.sort((a, b) => columns.indexOf(a.column) - columns.indexOf(b.column));
    onChange(dashboard.filters, next);
  };

  return (
    // One bordered card for the whole set, like a scorecard tile: eight loose selects read as page
    // furniture, the same eight inside a frame read as the dashboard's date controls.
    <div className="dm-card flex flex-wrap items-end gap-4 p-3">
      {columns.map(column => {
        const slice = slices.find(s => s.column === column);
        const value = slice ? presetValue(slice.value) : null;
        return (
          <label key={column} className="flex flex-col gap-1 text-xs">
            <span className="font-medium">{columnLabel(fields, column)}</span>
            <div className="flex items-center gap-2">
              <select
                aria-label={`${columnLabel(fields, column)} range`}
                className="rounded border px-2 py-1 text-sm"
                value={value?.kind ?? ALL_TIME}
                onChange={e => {
                  const kind = e.target.value;
                  if (kind === ALL_TIME) return setRange(column, null);
                  setRange(column, needsN(kind) ? { kind, n: value?.n ?? DEFAULT_PRESET.n } : { kind });
                }}
              >
                <option value={ALL_TIME}>All time</option>
                {RELATIVE_PRESETS.map(p => (
                  <option key={p.kind} value={p.kind}>{p.label}</option>
                ))}
              </select>
              {value && needsN(value.kind) && (
                <input
                  aria-label={`${columnLabel(fields, column)} N`}
                  type="number"
                  min={1}
                  className="w-16 rounded border px-2 py-1 text-sm"
                  value={value.n ?? DEFAULT_PRESET.n}
                  onChange={e => setRange(column, { kind: value.kind, n: Number(e.target.value) })}
                />
              )}
            </div>
          </label>
        );
      })}
      {filters.length > 0 && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Filtered by: {filters.map(describeFilter).join(', ')}
        </p>
      )}
      <button className="rounded border px-3 py-1.5 text-sm" onClick={onResetAll}>Reset filters</button>
    </div>
  );
}
