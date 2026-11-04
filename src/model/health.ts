import type { MartDetail, OwoxLike } from '../owox/sources';
import { fetchMartDetail, flattenFields } from '../owox/sources';
import { runPool } from '../lib/pool';
import type { Model } from '../types';

export type IssueKind =
  | 'mart_missing' | 'fact_field_missing' | 'date_field_missing'
  | 'plan_mart_missing' | 'plan_field_missing' | 'forecast_mart_missing' | 'forecast_field_missing';

export interface Issue { kind: IssueKind; classId: string; metricId: string | null; text: string }

/** Issues that stop a metric from being queried at all; the others only drop its plan or forecast source. */
export const BLOCKING: ReadonlySet<IssueKind> = new Set<IssueKind>(['mart_missing', 'fact_field_missing', 'date_field_missing']);

/**
 * Compares the model with the schemas of the Data Marts it references. A Data Mart the member can't
 * list, or whose schema fails to load, counts as missing. Returns the schemas it did read, so the
 * caller can reuse them. Never throws.
 */
export async function checkHealth(
  owox: OwoxLike, model: Model, accessible: ReadonlySet<string>,
): Promise<{ issues: Issue[]; details: Map<string, MartDetail> }> {
  const wanted = new Set<string>();
  for (const c of model.classes) wanted.add(c.martId);
  for (const m of model.metrics) {
    wanted.add(m.martId);
    if (m.plan) wanted.add(m.plan.martId);
    if (m.forecast) wanted.add(m.forecast.martId);
  }
  const ids = [...wanted].filter((id) => accessible.has(id));
  const details = new Map<string, MartDetail>();
  await runPool(ids.map((id) => async () => { details.set(id, await fetchMartDetail(owox, id)); }), 6);

  const paths = new Map([...details].map(([id, d]) => [id, new Set(flattenFields(d.fields).map((f) => f.path))]));
  const issues: Issue[] = [];
  const classOf = new Map<string, string>();
  for (const c of model.classes) for (const id of c.metricIds) classOf.set(id, c.id);
  const title = (id: string, fallback: string) => details.get(id)?.title ?? fallback;

  const gone = new Set<string>();
  for (const c of model.classes) {
    if (details.has(c.martId)) continue;
    gone.add(c.martId);
    issues.push({ kind: 'mart_missing', classId: c.id, metricId: null, text: 'Data Mart not found' });
  }

  for (const m of model.metrics) {
    const classId = classOf.get(m.id) ?? m.martId;
    const name = model.classes.find((c) => c.id === classId)?.title ?? m.martId;
    const add = (kind: IssueKind, text: string) => issues.push({ kind, classId, metricId: m.id, text });
    // the class's own issue already says its Data Mart is gone
    if (!details.has(m.martId)) { if (!gone.has(m.martId)) add('mart_missing', 'Data Mart not found'); }
    else {
      const set = paths.get(m.martId)!;
      const t = title(m.martId, name);
      if (!set.has(m.measure.field)) add('fact_field_missing', `Field ${m.measure.field} no longer exists in ${t}`);
      if (m.dateField && !set.has(m.dateField)) add('date_field_missing', `Date field ${m.dateField} no longer exists in ${t}`);
    }
    for (const [src, label] of [[m.plan, 'plan'], [m.forecast, 'forecast']] as const) {
      if (!src) continue;
      const set = paths.get(src.martId);
      const t = title(src.martId, src.martId);
      if (!set) { add(`${label}_mart_missing`, `The ${label} Data Mart was not found`); continue; }
      const missing = [src.measure.field, src.dateField].filter((f) => !set.has(f));
      if (missing.length) add(`${label}_field_missing`, `The ${label} field ${missing.join(', ')} no longer exists in ${t}`);
    }
  }
  return { issues, details };
}
