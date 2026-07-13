// shadcn/ui `chart` primitive (canonical source: https://ui.shadcn.com/docs/components/chart),
// adapted for this plugin: relative `cn` import, Tailwind v3 syntax (`bg-[var(--x)]` instead of
// v4's `bg-(--x)` shorthand), and trimmed to the pieces BarChartView.tsx, PieChartView.tsx, and
// TimeSeriesChart.tsx actually use (ChartContainer / ChartTooltip / ChartTooltipContent) — no
// legend support.
import * as React from 'react';
import * as RechartsPrimitive from 'recharts';

import { cn } from '../../lib/cn';

// Format: { [dataKey]: { label, color } }. ChartStyle turns `color` into a `--color-{key}` CSS
// custom property scoped to this chart instance (via `[data-chart=id]`), so series can reference
// `var(--color-{key})` (which in turn is one of the plugin's `--chart-1..5` tokens).
export type ChartConfig = Record<string, { label?: React.ReactNode; color?: string }>;

type ChartContextProps = { config: ChartConfig };
const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error('useChart must be used within a <ChartContainer />');
  return context;
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children'];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none flex aspect-video justify-center text-xs",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorConfig = Object.entries(config).filter(([, cfg]) => cfg.color);
  if (!colorConfig.length) return null;

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `[data-chart=${id}] {\n${colorConfig.map(([key, cfg]) => `  --color-${key}: ${cfg.color};`).join('\n')}\n}`,
      }}
    />
  );
}

const ChartTooltip = RechartsPrimitive.Tooltip;

function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const rec = payload as Record<string, unknown>;
  const nested = rec.payload && typeof rec.payload === 'object' ? (rec.payload as Record<string, unknown>) : undefined;

  let configKey = key;
  if (typeof rec[key] === 'string') configKey = rec[key] as string;
  else if (nested && typeof nested[key] === 'string') configKey = nested[key] as string;

  return config[configKey] ?? config[key];
}

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = 'dot',
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  nameKey,
  labelKey,
}: React.ComponentProps<typeof RechartsPrimitive.Tooltip> & {
  className?: string;
  indicator?: 'line' | 'dot' | 'dashed';
  hideLabel?: boolean;
  hideIndicator?: boolean;
  labelClassName?: string;
  nameKey?: string;
  labelKey?: string;
}) {
  const { config } = useChart();

  if (!active || !payload?.length) return null;

  const [firstItem] = payload;
  const labelKeyResolved = `${labelKey ?? firstItem?.dataKey ?? firstItem?.name ?? 'value'}`;
  const labelItemConfig = getPayloadConfigFromPayload(config, firstItem, labelKeyResolved);
  const resolvedLabel = labelFormatter
    ? labelFormatter(label, payload)
    : (labelItemConfig?.label ?? (typeof label === 'string' ? label : null));

  return (
    <div
      className={cn(
        'border-border/50 bg-card text-card-foreground grid min-w-[8rem] items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-md',
        className,
      )}
    >
      {!hideLabel && resolvedLabel != null && <div className={cn('font-medium', labelClassName)}>{resolvedLabel}</div>}
      <div className="grid gap-1.5">
        {payload.map((item, index) => {
          const key = `${nameKey ?? item.name ?? item.dataKey ?? 'value'}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);
          const indicatorColor = item.color ?? (item.payload as Record<string, unknown> | undefined)?.fill;

          return (
            <div key={item.dataKey ?? index} className={cn('flex w-full items-center gap-2')}>
              {!hideIndicator && (
                <span
                  className={cn('shrink-0 rounded-[2px]', {
                    'h-2.5 w-2.5': indicator === 'dot',
                    'h-2.5 w-1': indicator === 'line',
                    'h-0 w-2.5 border-t-[1.5px] border-dashed': indicator === 'dashed',
                  })}
                  style={{ backgroundColor: indicator === 'dashed' ? undefined : (indicatorColor as string), borderColor: indicatorColor as string }}
                />
              )}
              <div className="flex flex-1 items-center justify-between leading-none">
                <span className="text-muted-foreground">{itemConfig?.label ?? item.name}</span>
                {item.value != null && (
                  <span className="text-foreground ml-2 font-mono font-medium tabular-nums">
                    {typeof item.value === 'number' ? item.value.toLocaleString() : String(item.value)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { ChartContainer, ChartStyle, ChartTooltip, ChartTooltipContent };
