export type Day = string; // 'YYYY-MM-DD', UTC

export type Preset =
  | 'last_year' | 'last_quarter' | 'last_month' | 'last_week'
  | 'last_28d' | 'last_7d' | 'yesterday'
  | 'ytd'
  | 'this_year' | 'this_quarter' | 'this_month' | 'this_week';

export interface DateWindow { from: Day; to: Day } // both inclusive

export type RangeChoice = { kind: 'preset'; preset: Preset } | { kind: 'custom'; window: DateWindow };
export type ComparePreset = 'previous_period' | 'preceding_days' | 'year_before';
export type CompareChoice = { kind: 'off' } | { kind: 'preset'; preset: ComparePreset } | { kind: 'custom'; window: DateWindow };

export interface RangeSpec {
  label: string;             // closed-control text for the range: 'This quarter' or 'Oct 1 – Nov 2, 2026'
  anchor: Day;               // yesterday
  range: DateWindow;
  days: number;              // length of range in days
  factWindow: DateWindow | null;       // range clipped to the anchor; null when the range starts after it
  comparison: DateWindow | null;       // the comparison window actually queried (already matched to the fact window's length); null when off or when factWindow is null
  compareFact: DateWindow | null;      // factWindow cut to the comparison's length; null when comparison is off or no cut is needed
  endsInFuture: boolean;     // range.to > anchor
}

export type AggFn = 'SUM' | 'COUNT' | 'COUNT_DISTINCT' | 'AVG' | 'MIN' | 'MAX';
export type MetricKind = 'flow' | 'level';
export type PlanShape = 'daily' | 'cumulative' | 'level';
export type MetricRole = 'critical' | 'leading' | 'lagging' | 'unique';

/** fn null means a calculated field of level 'metric', selected by name without aggregation. */
export interface Measure { field: string; fn: AggFn | null }

export interface PlanDef { martId: string; measure: Measure; dateField: string; shape: PlanShape }

export interface MetricDef {
  id: string;                // `${martId}:${measure.field}:${fn ?? 'calc'}`
  martId: string;
  alias: string;             // "ARR"; for unique count the class title
  measure: Measure;
  kind: MetricKind;
  dateField: string | null;  // null: no date filter, all time, no series
  role: MetricRole;
  source: 'project' | string; // 'project' or a context id; 'schema' for unique count
  isUniqueCount: boolean;
  plan: PlanDef | null;
  /** The measure is a calculated field of the mart: only such a metric can colour a line. Absent on models built before it. */
  calculated?: boolean;
  description?: string | null; // the measure field's schema description; absent on models built before it
}

export interface ContextRef { id: string; name: string }

export interface ClassNode {
  id: string;                // equals martId
  martId: string;
  title: string;
  contexts: ContextRef[];
  depth: number;             // 0 = main class
  keyMetricId: string | null;
  metricIds: string[];       // key first, then badges in role order
}

/** `fields` are the calculated fields of `from` whose formulas reference `to`; absent on models built before it. */
export interface Edge { from: string; to: string; fields?: string[] }

export interface Model {
  version: 1;
  inputHash: string;
  builtAt: string;           // ISO timestamp
  builtBy: string;           // ctx.userId
  goal: { classId: string; metricId: string | null; goalMartId: string; viaFallback: boolean };
  classes: ClassNode[];
  edges: Edge[];
  metrics: MetricDef[];
}

export type BlockCode =
  | 'NO_GOAL' | 'GOAL_PLACEHOLDER' | 'GOAL_FIELD_NOT_FOUND' | 'GOAL_NO_PRIMARY_KEY'
  | 'GOAL_NOT_CONNECTED' | 'AI_NOT_CONFIGURED' | 'AI_INVALID';

export interface Blocked { code: BlockCode; detail: string; mismatches: string[] }

export type BuildResult = { ok: true; model: Model } | { ok: false; blocked: Blocked };

export type Status = 'neutral' | 'above' | 'near' | 'below';
export type Trend = 'up' | 'down' | 'flat';

/** Compact daily series: values[i] is the value on start + i days. */
export interface SeriesPack {
  start: Day;
  values: (number | null)[];
  forecastStart: Day | null;
  forecast: number[];
}

export interface MetricResult {
  fact: number | null;
  /** The metric over `RangeSpec.compareFact`; set only when a custom comparison cut the fact window short. `diffPct` is measured from it. */
  compareFact: number | null;
  comparison: number | null;
  diffPct: number | null;
  plan: number | null;
  forecast: number | null;
  forecastApprox: boolean;
  status: Status;
  trend: Trend;
  note: 'short_history' | 'no_date_field' | null;
  error: string | null;
}

export interface CardCache { metrics: Record<string, MetricResult>; spark: SeriesPack | null }

export interface CacheDoc {
  modelHash: string;
  builtAt: string;           // model.builtAt the doc was computed for
  thresholdPct: number;      // threshold the statuses were computed with
  anchor: Day;
  refreshedAt: string;
  key: string;               // cacheKey of the range and comparison
  comparison: boolean;
  cards: Record<string, CardCache>;
}

export interface Settings { thresholdPct: number; defaultPreset: Preset; comparisonDefault: boolean }

export const DEFAULT_SETTINGS: Settings = { thresholdPct: 20, defaultPreset: 'this_quarter', comparisonDefault: true };

export const PRESET_LABELS: Record<Preset, string> = {
  last_year: 'Last year', last_quarter: 'Last quarter', last_month: 'Last month', last_week: 'Last week',
  last_28d: 'Last 28 days', last_7d: 'Last 7 days', yesterday: 'Yesterday',
  ytd: 'Year to date',
  this_year: 'This year', this_quarter: 'This quarter', this_month: 'This month', this_week: 'This week',
};

/** What the default comparison window is, per preset (see `rangeFor` in lib/dates); shown after "vs". */
export const COMPARE_LABELS: Record<Preset, string> = {
  last_year: 'Year Before', last_quarter: 'Quarter Before', last_month: 'Month Before', last_week: 'Week Before',
  last_28d: 'Previous 28 Days', last_7d: 'Previous 7 Days', yesterday: 'Day Before',
  ytd: 'Last Year to Date',
  this_year: 'Last Year', this_quarter: 'Last Quarter', this_month: 'Last Month', this_week: 'Last Week',
};

export const PRESET_GROUPS: { label: string; presets: Preset[] }[] = [
  { label: 'Past', presets: ['last_year', 'last_quarter', 'last_month', 'last_week', 'last_28d', 'last_7d', 'yesterday'] },
  { label: 'To date', presets: ['ytd'] },
  { label: 'Current', presets: ['this_year', 'this_quarter', 'this_month', 'this_week'] },
];
