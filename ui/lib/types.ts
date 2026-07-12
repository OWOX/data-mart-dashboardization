// ---------- OWOX query API (POST /api/data-marts/:id/query) ----------

export type AggregateFunction =
  | 'SUM' | 'COUNT' | 'COUNT_DISTINCT' | 'AVG' | 'MIN' | 'MAX'
  | 'P25' | 'P50' | 'P75' | 'P95';

/** No HOUR: DAY is the finest grain the query service supports. */
export type DateTruncUnit = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

export type AggregationRule = { column: string; function: AggregateFunction };
export type DateTruncRule = { column: string; unit: DateTruncUnit; timeZone?: string };
export type SortRule = { column: string; direction: 'asc' | 'desc' };

/** `in`/`not_in`/`this_week` are REJECTED by the service — never emit them. */
export type FilterRule = {
  column: string;
  operator: string;
  value?: unknown;
  placement?: 'pre-join' | 'post-join';
};

export type QueryRequest = {
  fields: string[];
  filterConfig?: FilterRule[] | null;
  aggregationConfig?: AggregationRule[] | null;
  dateTruncConfig?: DateTruncRule[] | null;
  limit?: number;
};

export type QueryResult = {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  totals: Record<string, number | string | boolean | null> | null;
};

// ---------- Data mart schema ----------

export type FieldRole = 'dimension' | 'metric';

export type MartField = {
  name: string;
  type: string;
  role: FieldRole;
  allowedAggregations: AggregateFunction[];
};

export type MartRef = { id: string; title: string };

// ---------- The dashboard document ----------

export type ComponentType = 'scorecard' | 'timeseries' | 'bar' | 'pie' | 'donut' | 'table';

export type ScorecardConfig = { metric: string; aggregation: AggregateFunction };
export type TimeSeriesConfig = {
  dateField: string; metric: string; aggregation: AggregateFunction;
  unit: DateTruncUnit; breakdown?: string;
};
export type BarConfig = {
  dimension: string; metric: string; aggregation: AggregateFunction;
  orientation: 'vertical' | 'horizontal'; limit: number;
  sort?: 'asc' | 'desc';
};
export type PieConfig = {
  dimension: string; metric: string; aggregation: AggregateFunction; maxCategories: number;
};
export type TableConfig = { columns: string[]; sort?: SortRule[]; limit: number };

export type ComponentConfig =
  | ScorecardConfig | TimeSeriesConfig | BarConfig | PieConfig | TableConfig;

export type Component = {
  id: string;
  type: ComponentType;
  title: string;
  description?: string;
  /** Column span, 1..gridColumns. */
  width: number;
  /** Row span. Default 1. */
  height: number;
  config: ComponentConfig;
};

export type Dashboard = {
  id: string;
  /** Binds the doc's ACL to the ONE data mart it visualises. Host-enforced. */
  $entity: { type: 'data-mart'; id: string };
  name: string;
  gridColumns: number;
  /** GLOBAL — applied to every component. No per-component overrides by design. */
  filters: FilterRule[];
  slices: FilterRule[];
  components: Component[];
  /** Bumped on every edit; doubles as the refetch key. */
  configVersion: number;
  generatedAt?: string;
  // Stamped server-side by the host on put — read-only to the plugin.
  // NOTE: there is no $createdBy here. The host stamps it but strips it before the doc reaches
  // the plugin (Task 2), because it holds a real user id. Do not add it back.
  $createdAt?: string;
  $updatedAt?: string;
};

export const emptyDashboard = (id: string, martId: string, name: string): Dashboard => ({
  id,
  $entity: { type: 'data-mart', id: martId },
  name,
  gridColumns: 5,
  filters: [],
  slices: [],
  components: [],
  configVersion: 0,
});
