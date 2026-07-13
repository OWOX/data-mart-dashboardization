import { RELATIVE_PRESETS } from '../lib/filterOps';
import type { Dashboard, FilterRule } from '../lib/types';

type RelativeValue = { kind: string; n?: number };

const DEFAULT_PRESET: RelativeValue = { kind: 'last_n_days', n: 30 };

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
  filters,
  onChange,
  onResetAll,
}: {
  /** The REAL dashboard — used only for `slices` (the date controls). */
  dashboard: Dashboard;
  /** The EFFECTIVE filters (persisted + ephemeral cross-filters), for display only. */
  filters: FilterRule[];
  /** Slice edits only — unchanged signature, always passes through the real `dashboard.filters`. */
  onChange: (filters: FilterRule[], slices: FilterRule[]) => void;
  /** Clears BOTH the persisted filters and the ephemeral cross-filters. */
  onResetAll: () => void;
}) {
  const { slices } = dashboard;
  if (slices.length === 0 && filters.length === 0) return null;

  const updateSlice = (index: number, value: RelativeValue) => {
    const next = slices.map((s, i) => (i === index ? { ...s, operator: 'relative_date', value } : s));
    onChange(dashboard.filters, next);
  };

  return (
    <div className="flex flex-wrap items-end gap-4">
      {slices.map((s, i) => {
        const value = presetValue(s.value);
        return (
          <label key={s.column} className="flex flex-col gap-1 text-xs">
            <span className="font-medium">{s.column}</span>
            <div className="flex items-center gap-2">
              <select
                aria-label={`${s.column} range`}
                className="rounded border px-2 py-1 text-sm"
                value={value.kind}
                onChange={e => {
                  const kind = e.target.value;
                  updateSlice(i, needsN(kind) ? { kind, n: value.n ?? DEFAULT_PRESET.n } : { kind });
                }}
              >
                {RELATIVE_PRESETS.map(p => (
                  <option key={p.kind} value={p.kind}>{p.label}</option>
                ))}
              </select>
              {needsN(value.kind) && (
                <input
                  aria-label={`${s.column} N`}
                  type="number"
                  min={1}
                  className="w-16 rounded border px-2 py-1 text-sm"
                  value={value.n ?? DEFAULT_PRESET.n}
                  onChange={e => updateSlice(i, { kind: value.kind, n: Number(e.target.value) })}
                />
              )}
            </div>
          </label>
        );
      })}
      {filters.length > 0 && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Filtered by: {filters.map(f => `${f.column} = ${String(f.value)}`).join(', ')}
        </p>
      )}
      <button className="rounded border px-3 py-1.5 text-sm" onClick={onResetAll}>Reset filters</button>
    </div>
  );
}
