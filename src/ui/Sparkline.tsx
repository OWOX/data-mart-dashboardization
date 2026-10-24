import type { SeriesPack, Trend } from '../types';

const STROKE: Record<Trend, string> = { up: 'var(--green)', down: 'var(--red)', flat: 'var(--muted)' };

export function Sparkline({ spark, trend, width = 240, height = 40 }: { spark: SeriesPack; trend: Trend; width?: number; height?: number }) {
  const all = [...spark.values.filter((v): v is number => v !== null), ...spark.forecast];
  const total = spark.values.length + spark.forecast.length;
  if (all.length === 0 || total === 0) return <svg role="img" aria-label={`trend ${trend}`} width={width} height={height} />;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = 2;
  const x = (i: number) => (total <= 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (total - 1));
  const y = (v: number) => (max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * (height - 2 * pad));

  const segments: string[] = [];
  let cur: string[] = [];
  spark.values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) segments.push(cur.join(' '));
      cur = [];
    } else cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (cur.length) segments.push(cur.join(' '));

  const offset = spark.values.length;
  const forecastPts = spark.forecast.map((v, i) => `${x(offset + i).toFixed(1)},${y(v).toFixed(1)}`);
  let lastIdx = spark.values.length - 1;
  while (lastIdx >= 0 && spark.values[lastIdx] === null) lastIdx--;
  if (forecastPts.length && lastIdx >= 0) forecastPts.unshift(`${x(lastIdx).toFixed(1)},${y(spark.values[lastIdx] as number).toFixed(1)}`);

  return (
    <svg role="img" aria-label={`trend ${trend}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {segments.map((pts, i) => (
        <polyline key={i} points={pts} fill="none" stroke={STROKE[trend]} strokeWidth={1.5} />
      ))}
      {forecastPts.length > 0 && <polyline points={forecastPts.join(' ')} fill="none" stroke={STROKE[trend]} strokeWidth={1.5} strokeDasharray="3 3" />}
    </svg>
  );
}
