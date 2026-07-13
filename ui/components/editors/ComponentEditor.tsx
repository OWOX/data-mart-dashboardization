import {
  duplicateComponent, moveComponent, removeComponent, resizeComponent, retypeComponent, updateComponent,
} from '../../lib/edit';
import type {
  AggregateFunction, BarConfig, ComponentConfig, ComponentType, Dashboard, DateTruncUnit,
  MartField, PieConfig, ScorecardConfig, TableConfig, TimeSeriesConfig,
} from '../../lib/types';

const TYPE_OPTIONS: { type: ComponentType; label: string }[] = [
  { type: 'scorecard', label: 'Scorecard' },
  { type: 'timeseries', label: 'Time series' },
  { type: 'bar', label: 'Bar chart' },
  { type: 'pie', label: 'Pie chart' },
  { type: 'donut', label: 'Donut chart' },
  { type: 'table', label: 'Table' },
];

/** No HOUR — DAY is the finest grain the query service supports (see types.ts / compile.ts). */
const UNIT_OPTIONS: DateTruncUnit[] = ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'];

/** Mirrors `CreateDashboardDialog`'s local date-type test — not exported from generate.ts. */
const isDateField = (f: MartField) => /^(DATE|DATETIME|TIMESTAMP)$/i.test(f.type);

/** The service caps a single query at 1000 rows (see compile.ts's MAX_LIMIT). */
const MAX_QUERY_LIMIT = 1000;

const labelClass = 'flex flex-col gap-1 text-xs';
const inputClass = 'rounded border px-2 py-1 text-sm';

/**
 * The editor sheet for one component, opened from its card's ⋯ menu. Every control routes
 * through `ui/lib/edit.ts` so the configVersion boundary lives in exactly one place: cosmetic
 * fields (title, description, width, height) go through `updateComponent`/`resizeComponent`
 * (no bump), everything that changes the compiled query (type, dimension, metric, aggregation,
 * granularity, breakdown, sort, limit) goes through `retypeComponent`/`updateComponent`'s
 * config patch (bumps). Aggregation choices are restricted to the selected field's
 * `allowedAggregations` — this is the one place in the plugin with both a MartField list and a
 * component config in scope, so it is where that governance rule is actually enforced.
 */
export function ComponentEditor({
  dashboard, componentId, fields, onChange, onClose,
}: {
  dashboard: Dashboard;
  componentId: string;
  fields: MartField[];
  onChange: (next: Dashboard) => void;
  onClose: () => void;
}) {
  const component = dashboard.components.find(c => c.id === componentId);
  if (!component) return null;

  const metricFields = fields.filter(f => f.role === 'metric' && f.allowedAggregations.length > 0);
  const dimensionFields = fields.filter(f => f.role === 'dimension');
  const dateFields = fields.filter(isDateField);
  const breakdownFields = fields.filter(f => f.role === 'dimension' && !isDateField(f));

  const aggregationOptionsFor = (metricName: string, current: AggregateFunction): AggregateFunction[] => {
    const allowed = fields.find(f => f.name === metricName)?.allowedAggregations ?? [];
    // Defensive: keep the CURRENT value selectable even if the schema no longer allows it (a
    // hand-edited/legacy doc), rather than silently reset it to the first option out from under
    // the user — same "coerce, don't crash" spirit as compile.ts's dir()/clamp().
    return allowed.includes(current) ? allowed : [...allowed, current];
  };

  const patchConfig = (next: Partial<ComponentConfig>) => {
    onChange(updateComponent(dashboard, componentId, { config: { ...component.config, ...next } as ComponentConfig }));
  };

  const renderTypeFields = () => {
    switch (component.type) {
      case 'scorecard': {
        const c = component.config as ScorecardConfig;
        return (
          <>
            <label className={labelClass}>
              <span className="font-medium">Metric</span>
              <select
                className={inputClass}
                value={c.metric}
                onChange={e => {
                  const metric = e.target.value;
                  const allowed = fields.find(f => f.name === metric)?.allowedAggregations ?? [];
                  patchConfig({ metric, aggregation: allowed.includes(c.aggregation) ? c.aggregation : (allowed[0] ?? c.aggregation) });
                }}
              >
                {[c.metric, ...metricFields.map(f => f.name)]
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              <span className="font-medium">Aggregation</span>
              <select className={inputClass} value={c.aggregation} onChange={e => patchConfig({ aggregation: e.target.value as AggregateFunction })}>
                {aggregationOptionsFor(c.metric, c.aggregation).map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
          </>
        );
      }
      case 'timeseries': {
        const c = component.config as TimeSeriesConfig;
        return (
          <>
            <label className={labelClass}>
              <span className="font-medium">Date field</span>
              <select className={inputClass} value={c.dateField} onChange={e => patchConfig({ dateField: e.target.value })}>
                {[c.dateField, ...dateFields.map(f => f.name)]
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              <span className="font-medium">Metric</span>
              <select
                className={inputClass}
                value={c.metric}
                onChange={e => {
                  const metric = e.target.value;
                  const allowed = fields.find(f => f.name === metric)?.allowedAggregations ?? [];
                  patchConfig({ metric, aggregation: allowed.includes(c.aggregation) ? c.aggregation : (allowed[0] ?? c.aggregation) });
                }}
              >
                {[c.metric, ...metricFields.map(f => f.name)]
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              <span className="font-medium">Aggregation</span>
              <select className={inputClass} value={c.aggregation} onChange={e => patchConfig({ aggregation: e.target.value as AggregateFunction })}>
                {aggregationOptionsFor(c.metric, c.aggregation).map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              <span className="font-medium">Granularity</span>
              <select className={inputClass} value={c.unit} onChange={e => patchConfig({ unit: e.target.value as DateTruncUnit })}>
                {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              <span className="font-medium">Breakdown</span>
              <select
                className={inputClass}
                value={c.breakdown ?? ''}
                onChange={e => patchConfig({ breakdown: e.target.value || undefined })}
              >
                <option value="">None</option>
                {breakdownFields.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
              </select>
            </label>
          </>
        );
      }
      case 'bar': {
        const c = component.config as BarConfig;
        return (
          <>
            <label className={labelClass}>
              <span className="font-medium">Dimension</span>
              <select className={inputClass} value={c.dimension} onChange={e => patchConfig({ dimension: e.target.value })}>
                {[c.dimension, ...dimensionFields.map(f => f.name)]
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              <span className="font-medium">Metric</span>
              <select
                className={inputClass}
                value={c.metric}
                onChange={e => {
                  const metric = e.target.value;
                  const allowed = fields.find(f => f.name === metric)?.allowedAggregations ?? [];
                  patchConfig({ metric, aggregation: allowed.includes(c.aggregation) ? c.aggregation : (allowed[0] ?? c.aggregation) });
                }}
              >
                {[c.metric, ...metricFields.map(f => f.name)]
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              <span className="font-medium">Aggregation</span>
              <select className={inputClass} value={c.aggregation} onChange={e => patchConfig({ aggregation: e.target.value as AggregateFunction })}>
                {aggregationOptionsFor(c.metric, c.aggregation).map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              <span className="font-medium">Orientation</span>
              <select className={inputClass} value={c.orientation} onChange={e => patchConfig({ orientation: e.target.value as BarConfig['orientation'] })}>
                <option value="vertical">Vertical</option>
                <option value="horizontal">Horizontal</option>
              </select>
            </label>
            <label className={labelClass}>
              <span className="font-medium">Sort</span>
              <select className={inputClass} value={c.sort ?? 'desc'} onChange={e => patchConfig({ sort: e.target.value as 'asc' | 'desc' })}>
                <option value="desc">Highest first</option>
                <option value="asc">Lowest first</option>
              </select>
            </label>
            <label className={labelClass}>
              <span className="font-medium">Limit</span>
              <input
                type="number" min={1} max={MAX_QUERY_LIMIT} className={inputClass} value={c.limit}
                onChange={e => patchConfig({ limit: clampLimit(Number(e.target.value)) })}
              />
            </label>
          </>
        );
      }
      case 'pie':
      case 'donut': {
        const c = component.config as PieConfig;
        return (
          <>
            <label className={labelClass}>
              <span className="font-medium">Dimension</span>
              <select className={inputClass} value={c.dimension} onChange={e => patchConfig({ dimension: e.target.value })}>
                {[c.dimension, ...dimensionFields.map(f => f.name)]
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              <span className="font-medium">Metric</span>
              <select
                className={inputClass}
                value={c.metric}
                onChange={e => {
                  const metric = e.target.value;
                  const allowed = fields.find(f => f.name === metric)?.allowedAggregations ?? [];
                  patchConfig({ metric, aggregation: allowed.includes(c.aggregation) ? c.aggregation : (allowed[0] ?? c.aggregation) });
                }}
              >
                {[c.metric, ...metricFields.map(f => f.name)]
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              <span className="font-medium">Aggregation</span>
              <select className={inputClass} value={c.aggregation} onChange={e => patchConfig({ aggregation: e.target.value as AggregateFunction })}>
                {aggregationOptionsFor(c.metric, c.aggregation).map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              <span className="font-medium">Max categories</span>
              <input
                type="number" min={1} max={MAX_QUERY_LIMIT} className={inputClass} value={c.maxCategories}
                onChange={e => patchConfig({ maxCategories: clampLimit(Number(e.target.value)) })}
              />
            </label>
          </>
        );
      }
      case 'table': {
        const c = component.config as TableConfig;
        const sortCol = c.sort?.[0]?.column ?? '';
        const sortDir = c.sort?.[0]?.direction ?? 'asc';
        return (
          <>
            <fieldset className={labelClass}>
              <legend className="font-medium">Columns</legend>
              <div className="max-h-40 space-y-1 overflow-auto rounded border p-2">
                {[...new Set([...c.columns, ...fields.map(f => f.name)])].map(name => (
                  <label key={name} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={c.columns.includes(name)}
                      onChange={e => {
                        const columns = e.target.checked
                          ? [...c.columns, name]
                          : c.columns.filter(col => col !== name);
                        // A table needs at least one column to compile — refuse to uncheck the
                        // last one rather than emit an uncompilable request (mirrors generate.ts's
                        // "omit rather than emit an uncompilable component" rule, adapted for an
                        // edit that must always leave a VALID config behind).
                        if (columns.length > 0) patchConfig({ columns });
                      }}
                    />
                    {name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className={labelClass}>
              <span className="font-medium">Sort by</span>
              <select
                className={inputClass}
                value={sortCol}
                onChange={e => patchConfig({ sort: e.target.value ? [{ column: e.target.value, direction: sortDir }] : undefined })}
              >
                <option value="">None</option>
                {c.columns.map(col => <option key={col} value={col}>{col}</option>)}
              </select>
            </label>
            {sortCol && (
              <label className={labelClass}>
                <span className="font-medium">Direction</span>
                <select
                  className={inputClass}
                  value={sortDir}
                  onChange={e => patchConfig({ sort: [{ column: sortCol, direction: e.target.value as 'asc' | 'desc' }] })}
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </label>
            )}
            <label className={labelClass}>
              <span className="font-medium">Limit</span>
              <input
                type="number" min={1} max={MAX_QUERY_LIMIT} className={inputClass} value={c.limit}
                onChange={e => patchConfig({ limit: clampLimit(Number(e.target.value)) })}
              />
            </label>
          </>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/40" role="dialog" aria-label={`Edit ${component.title}`}>
      <div className="dm-card h-full w-full max-w-sm overflow-y-auto rounded-none p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-medium">Edit component</h2>
          <button type="button" className="text-sm" onClick={onClose} aria-label="Close editor">✕</button>
        </div>

        <div className="space-y-3">
          <label className={labelClass}>
            <span className="font-medium">Title</span>
            <input
              className={inputClass} value={component.title}
              onChange={e => onChange(updateComponent(dashboard, componentId, { title: e.target.value }))}
            />
          </label>
          <label className={labelClass}>
            <span className="font-medium">Description</span>
            <input
              className={inputClass} value={component.description ?? ''}
              onChange={e => onChange(updateComponent(dashboard, componentId, { description: e.target.value || undefined }))}
            />
          </label>
          <label className={labelClass}>
            <span className="font-medium">Type</span>
            <select
              className={inputClass} value={component.type}
              onChange={e => onChange(retypeComponent(dashboard, componentId, e.target.value as ComponentType))}
            >
              {TYPE_OPTIONS.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
            </select>
          </label>

          <div className="flex gap-3">
            <label className={labelClass}>
              <span className="font-medium">Width</span>
              <input
                type="number" min={1} max={dashboard.gridColumns} className={inputClass} value={component.width}
                onChange={e => onChange(resizeComponent(dashboard, componentId, Number(e.target.value), component.height))}
              />
            </label>
            <label className={labelClass}>
              <span className="font-medium">Height</span>
              <input
                type="number" min={1} className={inputClass} value={component.height}
                onChange={e => onChange(resizeComponent(dashboard, componentId, component.width, Number(e.target.value)))}
              />
            </label>
          </div>

          {renderTypeFields()}

          <div className="flex flex-wrap gap-2 border-t pt-3">
            <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => onChange(moveComponent(dashboard, componentId, -1))}>
              Move left
            </button>
            <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => onChange(moveComponent(dashboard, componentId, 1))}>
              Move right
            </button>
            <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => onChange(duplicateComponent(dashboard, componentId))}>
              Duplicate
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 text-xs text-red-600"
              onClick={() => {
                onChange(removeComponent(dashboard, componentId));
                onClose();
              }}
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function clampLimit(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_QUERY_LIMIT, Math.trunc(n)));
}
