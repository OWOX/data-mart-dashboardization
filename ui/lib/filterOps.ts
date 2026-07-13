/**
 * The operator catalogue the UI may offer. It is deliberately NARROWER than the backend's schema:
 * `in`, `not_in`, `in_next_n_days` and `this_week` are rejected by the query service, so they are
 * never offered. That is why there are no multi-select dimension filters in v1.
 *
 * There is no generic filter-builder UI today — `FilterBar` only offers `RELATIVE_PRESETS` below
 * for date slices, and the only other filter-writer, cross-filtering (`ui/lib/edit.ts`'s
 * `addGlobalFilter`), hardcodes the `eq` operator. So a rejected operator (`in`/`not_in`/
 * `this_week`/`in_next_n_days`) currently has no code path that could ever emit it, and
 * `compile.ts` passing filter rules through verbatim is safe by construction. If a generic
 * filter-builder UI is ever added, THAT UI becomes the new enforcement point and must source its
 * operator list from a rule like this one.
 */

/** `this_week` and `in_next_n_days` are intentionally absent — the query service rejects both. */
export const RELATIVE_PRESETS: { kind: string; label: string; needsN: boolean }[] = [
  { kind: 'today', label: 'Today', needsN: false },
  { kind: 'yesterday', label: 'Yesterday', needsN: false },
  { kind: 'last_n_days', label: 'Last N days', needsN: true },
  { kind: 'this_month', label: 'This month', needsN: false },
  { kind: 'last_month', label: 'Last month', needsN: false },
  { kind: 'last_n_months', label: 'Last N months', needsN: true },
  { kind: 'this_year', label: 'This year', needsN: false },
];
