import type { SeriesPack, Trend } from '../types';

type Pt = [number, number];

/**
 * A smooth curve through the points that never overshoots them (monotone cubic, Fritsch–Carlson),
 * so a peak on the curve is a real value and the area never dips below its floor.
 */
export function smooth(pts: Pt[]): string {
  const f = (n: number) => n.toFixed(1);
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${f(pts[0]![0])},${f(pts[0]![1])}`;
  const n = pts.length;
  const dx = pts.slice(1).map((p, i) => p[0] - pts[i]![0]);
  const m = pts.slice(1).map((p, i) => (p[1] - pts[i]![1]) / (dx[i] || 1));
  const t = pts.map((_, i) => (i === 0 ? m[0]! : i === n - 1 ? m[n - 2]! : m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i]! / m[i]!, b = t[i + 1]! / m[i]!, h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]!; t[i + 1] = k * b * m[i]!; }
  }
  let d = `M${f(pts[0]![0])},${f(pts[0]![1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!, [x1, y1] = pts[i + 1]!, h = dx[i]! / 3;
    d += ` C${f(x0 + h)},${f(y0 + t[i]! * h)} ${f(x1 - h)},${f(y1 - t[i + 1]! * h)} ${f(x1)},${f(y1)}`;
  }
  return d;
}

/**
 * The series as a filled area along the card's bottom edge, with a 1px line on its top. The
 * forecast continues it in a paler fill under a dashed line. The SVG stretches to its box, so the
 * line keeps 1px however wide the card is.
 */
export function Sparkline({ spark, trend, width = 280, height = 48 }: { spark: SeriesPack; trend: Trend; width?: number; height?: number }) {
  const all = [...spark.values.filter((v): v is number => v !== null), ...spark.forecast];
  const total = spark.values.length + spark.forecast.length;
  if (all.length === 0 || total === 0) return <svg className="gy-spark" data-trend={trend} role="img" aria-label={`trend ${trend}`} />;
  const min = Math.min(...all);
  const max = Math.max(...all);
  // Headroom above the peak; the lowest value still sits a little above the edge, so it reads as a value.
  const top = 4;
  const floor = height - 6;
  const x = (i: number) => (total <= 1 ? width / 2 : (i * width) / (total - 1));
  const y = (v: number) => (max === min ? (top + floor) / 2 : top + (1 - (v - min) / (max - min)) * (floor - top));
  const pt = (i: number, v: number): Pt => [x(i), y(v)];

  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  spark.values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push(pt(i, v));
  });
  if (cur.length) runs.push(cur);

  const offset = spark.values.length;
  const forecast = spark.forecast.map((v, i) => pt(offset + i, v));
  let last = spark.values.length - 1;
  while (last >= 0 && spark.values[last] === null) last--;
  if (forecast.length && last >= 0) forecast.unshift(pt(last, spark.values[last] as number));

  // The curve closed down to the bottom edge, so its fill sits on the card's border.
  const area = (pts: Pt[]) => `${smooth(pts)} L${pts[pts.length - 1]![0].toFixed(1)},${height} L${pts[0]![0].toFixed(1)},${height} Z`;
  const one = (pts: Pt[]): Pt[] => (pts.length > 1 ? pts : [pts[0]!, pts[0]!]);

  return (
    <svg className="gy-spark" data-trend={trend} role="img" aria-label={`trend ${trend}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {forecast.length > 1 && <path className="gy-spark-forecast" d={area(forecast)} />}
      {forecast.length > 1 && <path className="gy-spark-forecast-line" d={smooth(forecast)} vectorEffect="non-scaling-stroke" />}
      {runs.map((pts, i) => <path key={`a${i}`} className="gy-spark-fact" d={area(one(pts))} />)}
      {runs.map((pts, i) => <path key={`l${i}`} className="gy-spark-line" d={smooth(one(pts))} vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}
