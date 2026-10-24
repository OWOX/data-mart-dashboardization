export type Day = string; // 'YYYY-MM-DD', UTC

export type Preset =
  | 'last_year' | 'last_quarter' | 'last_month' | 'last_week'
  | 'last_28d' | 'last_7d' | 'yesterday'
  | 'ytd'
  | 'this_year' | 'this_quarter' | 'this_month' | 'this_week';

export interface DateWindow { from: Day; to: Day } // both inclusive

export interface RangeSpec {
  preset: Preset;
  anchor: Day;               // yesterday
  range: DateWindow;
  days: number;              // length of range in days
  factWindow: DateWindow | null;       // range clipped to the anchor; null when the range starts after it
  comparison: DateWindow | null;       // factWindow shifted back by `days`; null when factWindow is null
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

export interface Edge { from: string; to: string }

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
  anchor: Day;
  refreshedAt: string;
  preset: Preset;
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

export const PRESET_GROUPS: { label: string; presets: Preset[] }[] = [
  { label: 'Past', presets: ['last_year', 'last_quarter', 'last_month', 'last_week', 'last_28d', 'last_7d', 'yesterday'] },
  { label: 'To date', presets: ['ytd'] },
  { label: 'Current', presets: ['this_year', 'this_quarter', 'this_month', 'this_week'] },
];
