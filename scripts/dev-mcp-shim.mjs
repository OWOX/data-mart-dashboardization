// DEV-ONLY scaffolding for the "Data Mart Dashboards" plugin.
//
// This script bridges the plugin's dev broker to the real app.owox.com MCP
// tool (`query_data_mart`) so local development can run against real data
// before `POST /api/data-marts/:id/query` is deployed on app.owox.com.
//
// Delete this file once that REST endpoint ships. It must never be imported
// by anything under `ui/` — it is a dev-only Node script, not part of the
// plugin's runtime bundle.

// ---------- pure query-mapping logic ----------

const NUMERIC_CELL = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

export function coerceCell(raw) {
  if (raw !== '' && NUMERIC_CELL.test(raw)) return Number(raw);
  return raw;
}

export function parseTsv(tsv) {
  if (tsv === '') return [];
  const lines = tsv.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map(line => line.split('\t').map(coerceCell));
}

export const AGG_TOKEN = {
  SUM: 'SUM', AVG: 'AVG', MIN: 'MIN', MAX: 'MAX', COUNT: 'COUNT',
  COUNT_DISTINCT: 'COUNTUNIQUE',
  P25: 'P25', P50: 'MEDIAN', P75: 'P75', P95: 'P95',
};

export function aggLabel(column, fn) {
  return `${column.replace(/\./g, '_')} | ${AGG_TOKEN[fn]}`;
}

export function mapQueryRequestToMcpArgs(dataMartId, body, opts = {}) {
  const args = { data_mart_id: dataMartId, fields: body.fields };
  if (body.aggregationConfig?.length) {
    args.aggregations = body.aggregationConfig.map(r => ({ field: r.column, function: r.function }));
  }
  if (body.dateTruncConfig?.length) {
    args.date_buckets = body.dateTruncConfig.map(r => ({
      field: r.column, unit: r.unit, ...(r.timeZone ? { time_zone: r.timeZone } : {}),
    }));
  }
  if (body.filterConfig?.length) {
    args.filters = body.filterConfig.map(r => ({
      field: r.column, operator: r.operator, ...(r.value !== undefined ? { value: r.value } : {}),
    }));
  }
  const limit = opts.limit ?? body.limit;
  if (limit !== undefined) args.limit = limit;
  return args;
}

export function resolveSortPlan(sortConfig, columns, aggregationConfig) {
  const plan = [];
  for (const rule of sortConfig) {
    let index = columns.indexOf(rule.column);
    if (index === -1) {
      const aggRule = aggregationConfig?.find(a => a.column === rule.column);
      if (aggRule) index = columns.indexOf(aggLabel(rule.column, aggRule.function));
    }
    if (index === -1) return { plan: null, unresolvedColumn: rule.column };
    plan.push({ index, direction: rule.direction });
  }
  return { plan };
}

function compareValues(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = String(a), sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export function sortAndTruncateRows(rows, plan, limit) {
  const sorted = [...rows].sort((r1, r2) => {
    for (const { index, direction } of plan) {
      const a = r1[index];
      const b = r2[index];
      // Nulls/undefined always sort last, independent of direction — the
      // direction flip below must never apply to this branch.
      if (a == null && b == null) continue;
      if (a == null) return 1;
      if (b == null) return -1;
      const cmp = compareValues(a, b);
      if (cmp !== 0) return direction === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
  return sorted.slice(0, limit);
}
