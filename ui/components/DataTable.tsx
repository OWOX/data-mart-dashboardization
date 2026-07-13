import { formatNumber } from '../lib/format';
import type { Component, QueryResult } from '../lib/types';

/**
 * Presentation only: `data.columns` and `data.rows` come straight from the server, which already
 * selected, filtered, sorted (via `config.sort` -> `compile()`'s `sortConfig`) and limited them.
 * This component must NEVER sort, rank, slice, paginate or aggregate that array itself — any
 * re-ranking has to go through `config.sort` + a `configVersion` bump so the SERVER re-sorts.
 * (The brief floats column show/hide + purely-cosmetic client sort as options; both are left out
 * of this pass — a display-only sort of the full row set still reads as "the table re-ranked
 * itself" to a user, which is exactly what the no-client-side-ranking rule exists to prevent, and
 * show/hide is easy to layer on later without touching this read path.)
 */
function renderCell(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return formatNumber(v);
}

// `component` is accepted (and unused) to match every other renderer's `renderComponent` call
// signature — the columns/rows rendered here always come from `data`, never re-derived from config.
export function DataTable({ data }: { component: Component; data: QueryResult | null }) {
  if (!data) return <p className="text-xs text-muted-foreground">No data yet.</p>;
  if (data.columns.length === 0) return <p className="text-xs text-muted-foreground">No columns configured.</p>;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr>
              {data.columns.map(col => (
                <th key={col} className="whitespace-nowrap border-b px-2 py-1 font-medium">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={data.columns.length} className="px-2 py-2 text-muted-foreground">
                  No rows.
                </td>
              </tr>
            ) : (
              data.rows.map((row, i) => (
                <tr key={i}>
                  {data.columns.map((col, j) => (
                    <td key={col} className="whitespace-nowrap border-b px-2 py-1">{renderCell(row[j])}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {data.truncated && (
        <p className="text-xs text-muted-foreground">
          Showing first {data.rows.length} row{data.rows.length === 1 ? '' : 's'} — results truncated.
        </p>
      )}
    </div>
  );
}
