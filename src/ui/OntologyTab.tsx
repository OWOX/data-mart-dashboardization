import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, GripVertical, Info } from 'lucide-react';
import { normalizeCurrency } from '../lib/format';
import { describeError } from '../lib/errors';
import { runPool } from '../lib/pool';
import { fetchMartDetail, type MartDetail, type OwoxLike } from '../owox/sources';
import { uncomputable } from '../model/aggregations';
import { applyChanges, diffModels, type Change } from '../model/diff';
import { deriveKeys } from '../model/shown';
import type { BuildStep } from '../model/build';
import type { BuildResult, Blocked as BlockedInfo, ClassNode, ForecastDef, MetricDef, MetricFormat, Model, Measure, PlanDef, PlanShape } from '../types';
import { useBelow } from './anchor';
import { Blocked } from './Blocked';
import { BuildProgress } from './BuildProgress';
import { RebuildProposal } from './RebuildProposal';
import { AGGS, FieldPicker, dateFields, fieldOptions, martFields, valueFields, type Option } from './FieldPicker';
import { ForecastPicker, type FieldGroup } from './ForecastPicker';

const FORMATS: { value: MetricFormat; label: string }[] = [{ value: 'number', label: 'Number' }, { value: 'percent', label: 'Percent' }, { value: 'currency', label: 'Currency' }];
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
    if (m.format === 'currency' && m.currency && !normalizeCurrency(m.currency)) return `${m.alias} has an invalid currency code`;
    if (m.plan && (!m.plan.measure.field || !m.plan.dateField)) return `The plan of ${m.alias} needs a field and a date field`;
    if (m.forecast && (!m.forecast.measure.field || !m.forecast.dateField)) return `The forecast of ${m.alias} needs a field and a date field`;
  }
  return null;
}

/** An (i) button that shows a live description on hover, focus and click. The text stays mounted so it is read once. */
function InfoTip({ name, text }: { name: string; text: string }) {
  const id = useId();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || focus || pinned;
  const anchor = useRef<HTMLSpanElement>(null);
  const style = useBelow(anchor, open);
  return (
    <span ref={anchor} className="gy-tip" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button" className="gy-tip-btn" aria-label={`About ${name}`} aria-describedby={id}
        onClick={() => setPinned((v) => !v)} onFocus={() => setFocus(true)} onBlur={() => { setFocus(false); setPinned(false); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { setHover(false); setFocus(false); setPinned(false); } }}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      <span role="tooltip" id={id} hidden={!open} className="gy-tip-pop" style={style}>{text}</span>
    </span>
  );
}

/** The live description of a source's field, if it has one. */
const fieldNoteOf = (detail: MartDetail | undefined, path: string): string | undefined =>
  martFields(detail?.fields ?? []).find((x) => x.path === path)?.field.description?.trim();

/** Field, aggregation and date field of one source as table cells. `noDate` is the date select's empty choice; `noField` leaves the field cell to the caller. */
function Source({ label, detail, status, measure, dateField, noDate, noField = false, onMeasure, onDate, children }: {
  label: string; detail: MartDetail | undefined; status: DetailStatus; measure: Measure; dateField: string; noDate?: Option; noField?: boolean;
  onMeasure: (m: Measure) => void; onDate: (d: string) => void; children?: React.ReactNode;
}) {
  const infos = martFields(detail?.fields ?? []);
  // a schema that is still loading, or couldn't be read, flags nothing
  const unverified = status === 'loading' || status === 'unreadable';
  const fieldNote = fieldNoteOf(detail, measure.field);
  const pick = (path: string) => {
    const calc = infos.find((x) => x.path === path)?.field.calculated?.level === 'metric';
    onMeasure({ field: path, fn: calc ? null : measure.fn ?? 'SUM' });
  };
  return (
    <>
      {!noField && (
        <td>
          <span className="gy-onto-cell">
            <FieldPicker label={`${label} field`} value={measure.field} options={fieldOptions(infos)} unverified={unverified} note={status === 'unreadable' ? "Couldn't read the schema" : undefined} onChange={pick} />
            {fieldNote && <InfoTip name={measure.field} text={fieldNote} />}
          </span>
        </td>
      )}
      <td>
        <FieldPicker
          label={`${label} aggregation`} value={measure.fn ?? CALCULATED}
          options={[{ value: CALCULATED, label: 'Calculated' }, ...AGGS.map((a) => ({ value: a, label: a }))]}
          onChange={(v) => onMeasure({ ...measure, fn: v === CALCULATED ? null : (v as Measure['fn']) })}
        />
      </td>
      <td><FieldPicker label={`${label} date field`} value={dateField} options={fieldOptions(dateFields(infos))} none={noDate} unverified={unverified} onChange={onDate} /></td>
      {children ?? <td />}
    </>
  );
}

export function OntologyTab({ model, details, marts, owox, now, onSave, onCancel, onRebuild, canRebuild = true, projectId = '', onOpen, onDismiss, hashOf }: {
  model: Model;
  /** The schemas the health check already read; others are fetched when a Data Mart is picked. */
  details: ReadonlyMap<string, MartDetail>;
  /** The Data Marts this member can choose from; null when the access check failed, so nothing is verified. */
  marts: { id: string; title: string; description?: string | null }[] | null;
  owox: OwoxLike;
  now: () => Date;
  onSave: (m: Model) => Promise<void>;
  onCancel: () => void;
  /** Builds a candidate model from the descriptions; saves nothing. */
  onRebuild?: (onStep: (s: BuildStep) => void) => Promise<BuildResult>; canRebuild?: boolean;
  projectId?: string; onOpen?: (path: string) => void;
  /** The proposal was discarded: the app stops flagging the hash it checked. */
  onDismiss?: () => void;
  /** The input hash of a model's Data Marts as the out-of-date check computes it; null when it can't be told. */
  hashOf?: (m: Model) => Promise<string | null>;
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
  const descriptions = useMemo(() => new Map((marts ?? []).map((m) => [m.id, m.description?.trim() ?? ''])), [marts]);
  // folded by default; local, never saved
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const toggleOpen = (id: string) => setOpenIds((p) => { const n = new Set(p); if (!n.delete(id)) n.add(id); return n; });
  const original = useMemo(() => new Map(model.metrics.map((m) => [m.id, m])), [model]);
  // a forecast list was opened: every accessible Data Mart's schema is read to fill it
  const [browseAll, setBrowseAll] = useState(false);

  // every Data Mart the draft references gets its schema, from the health check or from a fetch
  const referenced = useMemo(() => {
    const ids = new Set<string>();
    for (const c of draft.classes) ids.add(c.martId);
    for (const m of draft.metrics) { ids.add(m.martId); if (m.plan) ids.add(m.plan.martId); if (m.forecast) ids.add(m.forecast.martId); }
    return ids;
  }, [draft]);
  const wanted = useMemo(() => (browseAll && marts ? new Set([...referenced, ...marts.map((m) => m.id)]) : referenced), [browseAll, marts, referenced]);
  useEffect(() => {
    const ids = [...wanted].filter((id) => !details.has(id) && !requested.current.has(id) && !(accessible && !accessible.has(id)));
    for (const id of ids) requested.current.add(id);
    void runPool(ids.map((id) => async () => {
      const d = await fetchMartDetail(owox, id).catch(() => null);
      setExtra((p) => new Map(p).set(id, d));
    }), 6);
  }, [wanted, details, accessible, owox]);

  const detailOf = (id: string): { detail: MartDetail | undefined; status: DetailStatus } => {
    const detail = details.get(id) ?? extra.get(id) ?? undefined;
    if (detail) return { detail, status: 'ok' };
    // gone only when the access list was read and doesn't hold it
    if (accessible && !accessible.has(id)) return { detail, status: 'gone' };
    return { detail, status: extra.get(id) === null ? 'unreadable' : 'loading' };
  };

  /** What the pickers flag for a class: 1 when its Data Mart is gone, else one per flagged reference of its metrics. */
  const brokenIn = (c: ClassNode): number => {
    if (detailOf(c.martId).status === 'gone') return 1;
    // a source: a gone Data Mart counts once; a readable schema flags its field and date field as the pickers do
    const source = (martId: string, field: string, date: string): number => {
      const { detail, status } = detailOf(martId);
      if (status === 'gone') return 1;
      if (status !== 'ok' || !detail) return 0;
      const infos = martFields(detail.fields);
      const dates = new Set(dateFields(infos).map((x) => x.path));
      const fieldBad = field !== '' && !infos.some((x) => x.path === field);
      const dateBad = date !== '' && !dates.has(date);
      return (fieldBad ? 1 : 0) + (dateBad ? 1 : 0);
    };
    let n = 0;
    for (const id of c.metricIds) {
      const m = draft.metrics.find((x) => x.id === id);
      if (!m) continue;
      n += source(m.martId, m.measure.field, m.dateField ?? '');
      if (m.plan) n += source(m.plan.martId, m.plan.measure.field, m.plan.dateField);
      if (m.forecast) n += source(m.forecast.martId, m.forecast.measure.field, m.forecast.dateField);
    }
    return n;
  };

  // every edit re-derives the key: the first shown metric in the class's order
  const patchMetric = (id: string, f: (m: MetricDef) => MetricDef) => setDraft((d) => deriveKeys({ ...d, metrics: d.metrics.map((m) => (m.id === id ? f(m) : m)) }));
  const patchClass = (id: string, f: (c: ClassNode) => ClassNode) => setDraft((d) => deriveKeys({ ...d, classes: d.classes.map((c) => (c.id === id ? f(c) : c)) }));

  const [announcement, setAnnouncement] = useState('');
  const [drag, setDrag] = useState<{ classId: string; id: string; drop: number } | null>(null);
  const dragRef = useRef<{ classId: string; id: string; drop: number } | null>(null);
  const focusAfter = useRef<string | null>(null);
  // a moved row keeps the keyboard where it was
  useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    for (const b of document.querySelectorAll<HTMLElement>('[data-handle]')) if (b.dataset.handle === id) b.focus();
  }, [draft]);

  /** Moves one metric to `to` among the others of its class. */
  const moveMetric = (classId: string, id: string, to: number) => patchClass(classId, (c) => {
    const rest = c.metricIds.filter((x) => x !== id);
    rest.splice(Math.max(0, Math.min(to, rest.length)), 0, id);
    return { ...c, metricIds: rest };
  });
  const nudge = (c: ClassNode, m: MetricDef, by: -1 | 1) => {
    const at = c.metricIds.indexOf(m.id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= c.metricIds.length) return;
    focusAfter.current = m.id;
    moveMetric(c.id, m.id, to);
    setAnnouncement(`${m.alias} moved to position ${to + 1} of ${c.metricIds.length}`);
  };
  /** Where the pointer would drop the dragged metric, from the rows' boxes. */
  const dropAt = (handle: HTMLElement, id: string, y: number): number => {
    const rows = [...(handle.closest('table')?.querySelectorAll<HTMLElement>('tbody.gy-onto-metric') ?? [])].filter((t) => t.dataset.metricId !== id);
    return rows.filter((t) => { const r = t.getBoundingClientRect(); return r.top + r.height / 2 < y; }).length;
  };
  const startDrag = (e: React.PointerEvent<HTMLButtonElement>, c: ClassNode, m: MetricDef) => {
    if (e.button !== undefined && e.button > 0) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* the pointer is gone */ }
    const at = c.metricIds.indexOf(m.id);
    dragRef.current = { classId: c.id, id: m.id, drop: at };
    setDrag(dragRef.current);
  };
  const overDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const drop = dropAt(e.currentTarget, d.id, e.clientY);
    if (drop !== d.drop) { dragRef.current = { ...d, drop }; setDrag(dragRef.current); }
  };
  const endDrag = (commit: boolean, c: ClassNode, m: MetricDef) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!commit || !d || d.drop === c.metricIds.indexOf(m.id)) return;
    focusAfter.current = m.id;
    moveMetric(c.id, m.id, d.drop);
    setAnnouncement(`${m.alias} moved to position ${d.drop + 1} of ${c.metricIds.length}`);
  };

  const save = async () => {
    const next = deriveKeys(draft);
    const problem = validateDraft(next);
    // the named metric may sit in a folded class, so unfold them all
    if (problem) { setError(problem); setOpenIds(new Set(draft.classes.map((c) => c.id))); return; }
    setError(null);
    setSaving(true);
    try {
      await onSave({ ...next, editedAt: now().toISOString() });
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
      const next = applyChanges(model, candidate, picked, now().toISOString());
      // the hash covers the resulting model's Data Marts, as the check does; unknown keeps the old one
      await onSave({ ...next, inputHash: (await hashOf?.(next)) ?? model.inputHash });
    } catch (e) {
      setError(`Couldn't save the model: ${describeError(e)}`);
      setSaving(false);
    }
  };
  // no differences: the model is current, so remember the new input hash without calling it an edit
  const closeMatching = async () => {
    setSaving(true);
    try {
      const hash = await hashOf?.(model);
      if (!hash || hash === model.inputHash) { setSaving(false); closeRebuild(); return; }
      await onSave({ ...model, inputHash: hash });
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
  const martTitle = (id: string) => martOptions.find((o) => o.value === id)?.label ?? details.get(id)?.title ?? extra.get(id)?.title ?? id;
  // the forecast list: the fields of every offered Data Mart, grouped by it
  const forecastGroups: FieldGroup[] = martOptions.flatMap((o) => {
    const { detail, status } = detailOf(o.value);
    if (status === 'gone') return [];
    return [{ martId: o.value, title: o.label, status, options: fieldOptions(valueFields(martFields(detail?.fields ?? []))) }];
  });

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
      {rebuild.phase === 'blocked' && <Blocked blocked={rebuild.blocked} projectId={projectId} onRetry={() => void startRebuild()} onBack={closeRebuild} backLabel="Back to the model" embedded onOpen={onOpen} />}
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
          needs={(c) => (c.kind === 'class_removed' && c.classId === model.goal.classId
            ? rebuild.changes.find((x) => x.kind === 'class_added' && x.classId === rebuild.candidate.goal.classId) ?? null : null)}
          onApply={(picked) => void applyProposal(rebuild.candidate, picked)} onDiscard={() => { onDismiss?.(); closeRebuild(); }} onClose={() => void closeMatching()}
        />
      )}

      {rebuild.phase === 'idle' && canvasOrder(draft).map((c) => {
        const goal = c.id === draft.goal.classId;
        const classMart = detailOf(c.martId);
        const classNote = classMart.status === 'gone' ? 'Data Mart not found or not accessible' : classMart.status === 'unreadable' ? "Couldn't read the schema" : null;
        const metrics = c.metricIds.map((id) => draft.metrics.find((m) => m.id === id)).filter((m): m is MetricDef => !!m);
        const open = openIds.has(c.id);
        const bodyId = `gy-onto-body-${c.id}`;
        const shownCount = metrics.filter((m) => m.shown !== false).length;
        const broken = brokenIn(c);
        const martNote = descriptions.get(c.martId);
        // the metric the drop line sits above, or the last one when the drop is at the end
        const dragging = drag && drag.classId === c.id ? drag : null;
        const others = dragging ? metrics.filter((x) => x.id !== dragging.id) : [];
        const dropMark = dragging && dragging.drop < others.length ? others[dragging.drop]!.id : null;
        const dropEnd = dragging && dragging.drop >= others.length ? others[others.length - 1]?.id ?? null : null;
        return (
          <section key={c.id} className="dm-card gy-onto-class" aria-label={c.title}>
            <div className="gy-onto-class-head">
              <label className="gy-check" title={goal ? 'The goal is always shown' : undefined}>
                <input
                  type="checkbox" aria-label={c.title} checked={goal || c.shown !== false} disabled={goal}
                  onChange={(e) => patchClass(c.id, (x) => ({ ...x, shown: e.target.checked }))}
                />
              </label>
              <button type="button" className="gy-onto-fold" aria-expanded={open} aria-controls={bodyId} onClick={() => toggleOpen(c.id)}>
                {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                <strong>{c.title}</strong>
                {c.contexts.length > 0 && <span className="dm-muted gy-onto-contexts">{c.contexts.map((x) => x.name).join(', ')}</span>}
                <span className="dm-muted gy-onto-contexts">{shownCount} of {metrics.length} metrics shown</span>
                {broken > 0 && <span className="gy-bad-text">{broken} broken</span>}
              </button>
              {martNote && <InfoTip name={c.title} text={martNote} />}
              {classNote && <span className="gy-bad-text">{classNote}</span>}
            </div>
            <div id={bodyId} hidden={!open} className="gy-onto-body">
            {open && (
              <div className="gy-onto-scroll">
                <table className="gy-onto-table">
                  <thead>
                    <tr>
                      <th scope="col">Shown</th><th scope="col">Name</th><th scope="col">Format</th>
                      <th scope="col">Series</th><th scope="col">Data Mart</th><th scope="col">Field</th><th scope="col">Aggregation</th>
                      <th scope="col">Date field</th><th scope="col">Shape</th><th scope="col"><span className="gy-sr-only">Reorder</span></th>
                    </tr>
                  </thead>
                  {metrics.map((m) => {
                    const label = original.get(m.id)?.alias ?? m.alias;
                    const plan = m.plan;
                    const forecast = m.forecast;
                    const forecastMart = forecast ? detailOf(forecast.martId) : null;
                    const forecastNote = forecast && fieldNoteOf(forecastMart?.detail, forecast.measure.field);
                    const forecastMissing = !!forecast && !!forecastMart && (forecastMart.status === 'gone'
                      || (forecastMart.status === 'ok' && !martFields(forecastMart.detail?.fields ?? []).some((x) => x.path === forecast.measure.field)));
                    const combo = (
                      <ForecastPicker
                        martId={forecast?.martId ?? null} field={forecast?.measure.field ?? ''} groups={forecastGroups} missing={forecastMissing}
                        onOpen={() => setBrowseAll(true)}
                        onPick={(p) => patchMetric(m.id, (x) => {
                          if (!p) return { ...x, forecast: null };
                          const f = martFields(detailOf(p.martId).detail?.fields ?? []).find((i) => i.path === p.field)?.field;
                          const fn = f?.calculated?.level === 'metric' ? null : x.forecast?.measure.fn ?? 'SUM';
                          // the date field belongs to the Data Mart: a new one starts empty
                          const dateField = x.forecast?.martId === p.martId ? x.forecast.dateField : '';
                          return { ...x, forecast: { martId: p.martId, measure: { field: p.field, fn }, dateField } satisfies ForecastDef };
                        })}
                      />
                    );
                    return (
                      <tbody key={m.id} aria-label={`Metric ${label}`} data-metric-id={m.id} className={`gy-onto-metric${dragging?.id === m.id ? ' is-dragging' : ''}${dropMark === m.id ? ' is-drop-before' : ''}${dropEnd === m.id ? ' is-drop-end' : ''}`}>
                        <tr>
                          <td rowSpan={3}><span className="gy-onto-first"><input type="checkbox" className="gy-onto-check" aria-label="Shown" checked={m.shown !== false} onChange={(e) => patchMetric(m.id, (x) => ({ ...x, shown: e.target.checked }))} /></span></td>
                          <td rowSpan={3}><input className="gy-input gy-onto-name" aria-label="Name" value={m.alias} onChange={(e) => patchMetric(m.id, (x) => ({ ...x, alias: e.target.value }))} /></td>
                          <td rowSpan={3}>
                            <span className="gy-onto-cell">
                              <select className="gy-select" aria-label="Format" value={m.format} onChange={(e) => patchMetric(m.id, (x) => ({ ...x, format: e.target.value as MetricFormat, currency: e.target.value === 'currency' ? x.currency : null }))}>
                                {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                              </select>
                              {m.format === 'currency' && (
                                <input
                                  className="gy-input gy-onto-cur" aria-label="Currency code" placeholder="USD" maxLength={3} value={m.currency ?? ''}
                                  onChange={(e) => patchMetric(m.id, (x) => ({ ...x, currency: e.target.value.toUpperCase() || null }))}
                                />
                              )}
                            </span>
                          </td>
                          <th scope="row" className="gy-onto-label">Fact</th>
                          <td className="gy-onto-mart">{martTitle(m.martId)}</td>
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
                          <td rowSpan={3}>
                            <span className="gy-onto-first">
                              <button
                                type="button" className="gy-onto-grip" aria-label={`Reorder ${m.alias}`} title="Drag to reorder, or use the arrow keys" data-handle={m.id}
                                onPointerDown={(e) => startDrag(e, c, m)} onPointerMove={overDrag}
                                onPointerUp={() => endDrag(true, c, m)} onPointerCancel={() => endDrag(false, c, m)}
                                onKeyDown={(e) => {
                                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); nudge(c, m, e.key === 'ArrowUp' ? -1 : 1); }
                                }}
                              >
                                <GripVertical size={16} aria-hidden="true" />
                              </button>
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <th scope="row" className="gy-onto-label">Plan</th>
                          <td>
                            <FieldPicker
                              label="Plan data mart" value={plan?.martId ?? ''} options={martOptions} none={NO_MART} unverified={martsUnchecked}
                              onChange={(id) => patchMetric(m.id, (x) => ({
                                ...x, plan: id === '' ? null : { martId: id, measure: emptyMeasure(), dateField: '', shape: x.plan?.shape ?? 'daily' } satisfies PlanDef,
                              }))}
                            />
                          </td>
                          {plan ? (
                            <Source
                              label="Plan" {...detailOf(plan.martId)} measure={plan.measure} dateField={plan.dateField}
                              onMeasure={(measure) => patchMetric(m.id, (x) => (x.plan ? { ...x, plan: { ...x.plan, measure } } : x))}
                              onDate={(dateField) => patchMetric(m.id, (x) => (x.plan ? { ...x, plan: { ...x.plan, dateField } } : x))}
                            >
                              <td>
                                <select className="gy-select" aria-label="Plan shape" value={plan.shape} onChange={(e) => patchMetric(m.id, (x) => (x.plan ? { ...x, plan: { ...x.plan, shape: e.target.value as PlanShape } } : x))}>
                                  {SHAPES.map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                              </td>
                            </Source>
                          ) : <td colSpan={4} />}
                        </tr>
                        <tr>
                          <th scope="row" className="gy-onto-label">Forecast</th>
                          {/* one cell either way, so the box keeps focus when a source is picked */}
                          <td colSpan={2}>
                            <span className="gy-onto-cell">
                              {combo}
                              {forecast && forecastNote && <InfoTip name={forecast.measure.field} text={forecastNote} />}
                            </span>
                          </td>
                          {forecast ? (
                            <Source
                              label="Forecast" {...detailOf(forecast.martId)} measure={forecast.measure} dateField={forecast.dateField} noField
                              onMeasure={(measure) => patchMetric(m.id, (x) => (x.forecast ? { ...x, forecast: { ...x.forecast, measure } } : x))}
                              onDate={(dateField) => patchMetric(m.id, (x) => (x.forecast ? { ...x, forecast: { ...x.forecast, dateField } } : x))}
                            />
                          ) : <td colSpan={3} />}
                        </tr>
                        {uncomputable(m, detailOf(m.martId).detail) && (
                          <tr><td colSpan={10}><p className="gy-bad-text gy-form-note">OWOX can&apos;t compute this aggregation for this field</p></td></tr>
                        )}
                      </tbody>
                    );
                  })}
                </table>
              </div>
            )}
            </div>
          </section>
        );
      })}

      <div role="status" aria-live="polite" className="gy-sr-only">{announcement}</div>

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
