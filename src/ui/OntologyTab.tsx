import { useEffect, useMemo, useRef, useState } from 'react';
import { describeError } from '../lib/errors';
import { fetchMartDetail, type MartDetail, type OwoxLike } from '../owox/sources';
import { applyChanges, diffModels, type Change } from '../model/diff';
import type { BuildStep } from '../model/build';
import type { BuildResult, Blocked as BlockedInfo, ClassNode, ForecastDef, MetricDef, MetricRole, Model, Measure, PlanDef, PlanShape } from '../types';
import { Blocked } from './Blocked';
import { BuildProgress } from './BuildProgress';
import { RebuildProposal } from './RebuildProposal';
import { AGGS, FieldPicker, dateFields, martFields, type Option } from './FieldPicker';

const ROLES: MetricRole[] = ['critical', 'leading', 'lagging', 'unique'];
const SHAPES: PlanShape[] = ['daily', 'cumulative', 'level'];
const CALCULATED = 'CALC';
type DetailStatus = 'ok' | 'loading' | 'unreadable' | 'gone';
const NO_MART: Option = { value: '', label: 'None' };

/** The rebuild flow on the tab: nothing is saved until a proposal is applied. */
type Rebuild =
  | { phase: 'idle' }
  | { phase: 'building'; steps: BuildStep[] }
  | { phase: 'proposal'; candidate: Model; changes: Change[] }
  | { phase: 'blocked'; blocked: BlockedInfo }
  | { phase: 'error'; message: string };

/** Goal first, then closest to the goal: the canvas order. */
function canvasOrder(model: Model): ClassNode[] {
  const goal = model.classes.filter((c) => c.id === model.goal.classId);
  const rest = model.classes.filter((c) => c.id !== model.goal.classId).sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title));
  return [...goal, ...rest];
}

/** The first problem that stops a save, or null. */
export function validateDraft(model: Model): string | null {
  const byId = new Map(model.metrics.map((m) => [m.id, m]));
  for (const c of model.classes) {
    if (c.shown === false && c.id !== model.goal.classId) continue;
    const shown = c.metricIds.filter((id) => byId.get(id)?.shown !== false);
    if (shown.length > 0 && (!c.keyMetricId || !shown.includes(c.keyMetricId))) return `${c.title} needs a key metric`;
  }
  for (const m of model.metrics) {
    if (m.alias.trim() === '') return 'Every metric needs a name';
    if (m.plan && (!m.plan.measure.field || !m.plan.dateField)) return `The plan of ${m.alias} needs a field and a date field`;
    if (m.forecast && (!m.forecast.measure.field || !m.forecast.dateField)) return `The forecast of ${m.alias} needs a field and a date field`;
  }
  return null;
}

/** Field, aggregation and date field of one source. `noDate` is the date select's empty choice. */
function Source({ label, detail, status, measure, dateField, noDate, onMeasure, onDate, children }: {
  label: string; detail: MartDetail | undefined; status: DetailStatus; measure: Measure; dateField: string; noDate?: Option;
  onMeasure: (m: Measure) => void; onDate: (d: string) => void; children?: React.ReactNode;
}) {
  const infos = martFields(detail?.fields ?? []);
  // a schema that is still loading, or couldn't be read, flags nothing
  const unverified = status === 'loading' || status === 'unreadable';
  const toOption = (x: { path: string }): Option => ({ value: x.path, label: x.path });
  const pick = (path: string) => {
    const calc = infos.find((x) => x.path === path)?.field.calculated?.level === 'metric';
    onMeasure({ field: path, fn: calc ? null : measure.fn ?? 'SUM' });
  };
  return (
    <>
      <FieldPicker label={`${label} field`} value={measure.field} options={infos.map(toOption)} unverified={unverified} note={status === 'unreadable' ? "Couldn't read the schema" : undefined} onChange={pick} />
      <FieldPicker
        label={`${label} aggregation`} value={measure.fn ?? CALCULATED}
        options={[{ value: CALCULATED, label: 'Calculated' }, ...AGGS.map((a) => ({ value: a, label: a }))]}
        onChange={(v) => onMeasure({ ...measure, fn: v === CALCULATED ? null : (v as Measure['fn']) })}
      />
      <FieldPicker label={`${label} date field`} value={dateField} options={dateFields(infos).map(toOption)} none={noDate} unverified={unverified} onChange={onDate} />
      {children}
    </>
  );
}

export function OntologyTab({ model, details, marts, owox, now, onSave, onCancel, onRebuild, canRebuild = true, projectId = '', onOpen }: {
  model: Model;
  /** The schemas the health check already read; others are fetched when a Data Mart is picked. */
  details: ReadonlyMap<string, MartDetail>;
  /** The Data Marts this member can choose from; null when the access check failed, so nothing is verified. */
  marts: { id: string; title: string }[] | null;
  owox: OwoxLike;
  now: () => Date;
  onSave: (m: Model) => Promise<void>;
  onCancel: () => void;
  /** Builds a candidate model from the descriptions; saves nothing. */
  onRebuild?: (onStep: (s: BuildStep) => void) => Promise<BuildResult>; canRebuild?: boolean;
  projectId?: string; onOpen?: (path: string) => void;
}) {
  const [draft, setDraft] = useState<Model>(model);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rebuild, setRebuild] = useState<Rebuild>({ phase: 'idle' });
  // a proposal is judged against the saved model, so unsaved edits can't be kept alongside it
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(model), [draft, model]);
  // schemas fetched here; null: the fetch failed
  const [extra, setExtra] = useState<ReadonlyMap<string, MartDetail | null>>(new Map());
  const requested = useRef(new Set<string>());
  const accessible = useMemo(() => (marts ? new Set(marts.map((m) => m.id)) : null), [marts]);
  const original = useMemo(() => new Map(model.metrics.map((m) => [m.id, m])), [model]);

  // every Data Mart the draft references gets its schema, from the health check or from a fetch
  const referenced = useMemo(() => {
    const ids = new Set<string>();
    for (const c of draft.classes) ids.add(c.martId);
    for (const m of draft.metrics) { ids.add(m.martId); if (m.plan) ids.add(m.plan.martId); if (m.forecast) ids.add(m.forecast.martId); }
    return ids;
  }, [draft]);
  useEffect(() => {
    for (const id of referenced) {
      if (details.has(id) || requested.current.has(id) || (accessible && !accessible.has(id))) continue;
      requested.current.add(id);
      fetchMartDetail(owox, id).catch(() => null).then((d) => setExtra((p) => new Map(p).set(id, d)));
    }
  }, [referenced, details, accessible, owox]);

  const detailOf = (id: string): { detail: MartDetail | undefined; status: DetailStatus } => {
    const detail = details.get(id) ?? extra.get(id) ?? undefined;
    if (detail) return { detail, status: 'ok' };
    // gone only when the access list was read and doesn't hold it
    if (accessible && !accessible.has(id)) return { detail, status: 'gone' };
    return { detail, status: extra.get(id) === null ? 'unreadable' : 'loading' };
  };

  const patchMetric = (id: string, f: (m: MetricDef) => MetricDef) => setDraft((d) => ({ ...d, metrics: d.metrics.map((m) => (m.id === id ? f(m) : m)) }));
  const patchClass = (id: string, f: (c: ClassNode) => ClassNode) => setDraft((d) => ({ ...d, classes: d.classes.map((c) => (c.id === id ? f(c) : c)) }));

  const toggleMetric = (c: ClassNode, m: MetricDef, shown: boolean) => {
    patchMetric(m.id, (x) => ({ ...x, shown }));
    // the key metric stays one of the shown ones
    const others = c.metricIds.filter((id) => id !== m.id && draft.metrics.find((x) => x.id === id)?.shown !== false);
    if (!shown && c.keyMetricId === m.id) patchClass(c.id, (x) => ({ ...x, keyMetricId: others[0] ?? null }));
    if (shown && !c.keyMetricId) patchClass(c.id, (x) => ({ ...x, keyMetricId: m.id }));
  };

  const save = async () => {
    const problem = validateDraft(draft);
    if (problem) { setError(problem); return; }
    setError(null);
    setSaving(true);
    try {
      await onSave({ ...draft, editedAt: now().toISOString() });
    } catch (e) {
      setError(`Couldn't save the model: ${describeError(e)}`);
      setSaving(false);
    }
  };

  const startRebuild = async () => {
    if (!onRebuild) return;
    setError(null);
    setRebuild({ phase: 'building', steps: [] });
    try {
      const result = await onRebuild((step) => setRebuild((r) => (r.phase === 'building' ? { phase: 'building', steps: [...r.steps, step] } : r)));
      setRebuild(result.ok ? { phase: 'proposal', candidate: result.model, changes: diffModels(model, result.model) } : { phase: 'blocked', blocked: result.blocked });
    } catch (e) {
      setRebuild({ phase: 'error', message: describeError(e) });
    }
  };
  const applyProposal = async (candidate: Model, picked: Change[]) => {
    setError(null);
    setSaving(true);
    try {
      await onSave(applyChanges(model, candidate, picked, now().toISOString()));
    } catch (e) {
      setError(`Couldn't save the model: ${describeError(e)}`);
      setSaving(false);
    }
  };
  const closeRebuild = () => { setError(null); setRebuild({ phase: 'idle' }); };

  // without an access list only the Data Marts already referenced can be offered
  const martOptions: Option[] = marts
    ? marts.map((m) => ({ value: m.id, label: m.title }))
    : [...referenced].map((id) => ({ value: id, label: details.get(id)?.title ?? extra.get(id)?.title ?? id }));
  const martsUnchecked = marts === null;

  const emptyMeasure = (): Measure => ({ field: '', fn: 'SUM' });

  return (
    <div className="gy-onto">
      <section className="dm-card gy-onto-intro">
        <p className="gy-onto-note">Your model. Changes here only affect what you see.</p>
        {martsUnchecked && <p className="gy-bad-text">Couldn&apos;t check which Data Marts you can access; references aren&apos;t verified.</p>}
        {onRebuild && (
          <>
            <p className="dm-muted gy-form-note">
              Reads the project description and the Data Mart schemas again and proposes changes to your model.
              Use it after changing the metrics table, links or calculated fields.
            </p>
            <div className="gy-form-actions">
              <button type="button" className="gy-btn" onClick={() => void startRebuild()} disabled={!canRebuild || dirty || rebuild.phase !== 'idle'}>Rebuild model</button>
            </div>
            {!canRebuild && <p className="dm-muted gy-form-note">Ask a project admin to map an AI model</p>}
            {canRebuild && dirty && <p className="dm-muted gy-form-note">Save or cancel your edits first</p>}
          </>
        )}
      </section>

      {rebuild.phase === 'building' && <BuildProgress steps={rebuild.steps} embedded />}
      {rebuild.phase === 'blocked' && <Blocked blocked={rebuild.blocked} projectId={projectId} onRetry={() => void startRebuild()} onBack={closeRebuild} backLabel="Back to the model" onOpen={onOpen} />}
      {rebuild.phase === 'error' && (
        <section className="dm-card gy-onto-intro" aria-label="Rebuild proposal">
          <p role="alert" className="gy-form-error">{rebuild.message}</p>
          <div className="gy-form-actions">
            <button type="button" className="gy-btn gy-btn-primary" onClick={() => void startRebuild()}>Retry</button>
            <button type="button" className="gy-btn" onClick={closeRebuild}>Back to the model</button>
          </div>
        </section>
      )}
      {rebuild.phase === 'proposal' && (
        <RebuildProposal
          changes={rebuild.changes} busy={saving} error={error}
          titleOf={(id) => model.classes.find((c) => c.id === id)?.title ?? rebuild.candidate.classes.find((c) => c.id === id)?.title ?? id}
          nameOf={(id) => model.metrics.find((m) => m.id === id)?.alias ?? id}
          onApply={(picked) => void applyProposal(rebuild.candidate, picked)} onDiscard={closeRebuild}
        />
      )}

      {rebuild.phase === 'idle' && canvasOrder(draft).map((c) => {
        const goal = c.id === draft.goal.classId;
        const classMart = detailOf(c.martId);
        const classNote = classMart.status === 'gone' ? 'Data Mart not found or not accessible' : classMart.status === 'unreadable' ? "Couldn't read the schema" : null;
        const metrics = c.metricIds.map((id) => draft.metrics.find((m) => m.id === id)).filter((m): m is MetricDef => !!m);
        return (
          <section key={c.id} className="dm-card gy-onto-class" aria-label={c.title}>
            <div className="gy-onto-class-head">
              <label className="gy-check" title={goal ? 'The goal is always shown' : undefined}>
                <input
                  type="checkbox" checked={goal || c.shown !== false} disabled={goal}
                  onChange={(e) => patchClass(c.id, (x) => ({ ...x, shown: e.target.checked }))}
                />
                <strong>{c.title}</strong>
              </label>
              {c.contexts.length > 0 && <span className="dm-muted gy-onto-contexts">{c.contexts.map((x) => x.name).join(', ')}</span>}
              {classNote && <span className="gy-bad-text">{classNote}</span>}
            </div>
            {metrics.map((m) => {
              const label = original.get(m.id)?.alias ?? m.alias;
              const plan = m.plan;
              const forecast = m.forecast;
              return (
                <div key={m.id} role="group" aria-label={`Metric ${label}`} className="gy-onto-metric">
                  <div className="gy-onto-line">
                    <input type="checkbox" className="gy-onto-check" aria-label="Shown" checked={m.shown !== false} onChange={(e) => toggleMetric(c, m, e.target.checked)} />
                    <input
                      type="radio" className="gy-onto-check" name={`key-${c.id}`} aria-label="Key metric"
                      checked={c.keyMetricId === m.id} disabled={m.shown === false}
                      onChange={() => patchClass(c.id, (x) => ({ ...x, keyMetricId: m.id }))}
                    />
                    <input className="gy-input gy-onto-name" aria-label="Name" value={m.alias} onChange={(e) => patchMetric(m.id, (x) => ({ ...x, alias: e.target.value }))} />
                    <select className="gy-select" aria-label="Role" value={m.role} onChange={(e) => patchMetric(m.id, (x) => ({ ...x, role: e.target.value as MetricRole }))}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="gy-onto-line">
                    <span className="gy-onto-label">Fact</span>
                    <Source
                      label="Fact" {...detailOf(m.martId)} measure={m.measure} dateField={m.dateField ?? ''} noDate={{ value: '', label: 'No date (all time)' }}
                      onMeasure={(measure) => patchMetric(m.id, (x) => {
                        const f = martFields(detailOf(m.martId).detail?.fields ?? []).find((i) => i.path === measure.field)?.field;
                        return f && measure.field !== x.measure.field
                          ? { ...x, measure, calculated: f.calculated?.level === 'metric', description: f.description ?? null }
                          : { ...x, measure };
                      })}
                      onDate={(d) => patchMetric(m.id, (x) => ({ ...x, dateField: d === '' ? null : d }))}
                    />
                  </div>
                  <div className="gy-onto-line">
                    <span className="gy-onto-label">Plan</span>
                    <FieldPicker
                      label="Plan data mart" value={plan?.martId ?? ''} options={martOptions} none={NO_MART} unverified={martsUnchecked}
                      onChange={(id) => patchMetric(m.id, (x) => ({
                        ...x, plan: id === '' ? null : { martId: id, measure: emptyMeasure(), dateField: '', shape: x.plan?.shape ?? 'daily' } satisfies PlanDef,
                      }))}
                    />
                    {plan && (
                      <Source
                        label="Plan" {...detailOf(plan.martId)} measure={plan.measure} dateField={plan.dateField}
                        onMeasure={(measure) => patchMetric(m.id, (x) => (x.plan ? { ...x, plan: { ...x.plan, measure } } : x))}
                        onDate={(dateField) => patchMetric(m.id, (x) => (x.plan ? { ...x, plan: { ...x.plan, dateField } } : x))}
                      >
                        <select className="gy-select" aria-label="Plan shape" value={plan.shape} onChange={(e) => patchMetric(m.id, (x) => (x.plan ? { ...x, plan: { ...x.plan, shape: e.target.value as PlanShape } } : x))}>
                          {SHAPES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </Source>
                    )}
                  </div>
                  <div className="gy-onto-line">
                    <span className="gy-onto-label">Forecast</span>
                    <FieldPicker
                      label="Forecast data mart" value={forecast?.martId ?? ''} options={martOptions} none={{ value: '', label: 'Extrapolated' }} unverified={martsUnchecked}
                      onChange={(id) => patchMetric(m.id, (x) => ({
                        ...x, forecast: id === '' ? null : { martId: id, measure: emptyMeasure(), dateField: '' } satisfies ForecastDef,
                      }))}
                    />
                    {forecast && (
                      <Source
                        label="Forecast" {...detailOf(forecast.martId)} measure={forecast.measure} dateField={forecast.dateField}
                        onMeasure={(measure) => patchMetric(m.id, (x) => (x.forecast ? { ...x, forecast: { ...x.forecast, measure } } : x))}
                        onDate={(dateField) => patchMetric(m.id, (x) => (x.forecast ? { ...x, forecast: { ...x.forecast, dateField } } : x))}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}

      {rebuild.phase === 'idle' && (
        <>
          {error && <p role="alert" className="gy-form-error">{error}</p>}
          <div className="gy-form-actions">
            <button type="button" className="gy-btn gy-btn-primary" onClick={() => void save()} disabled={saving}>Save</button>
            <button type="button" className="gy-btn" onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
