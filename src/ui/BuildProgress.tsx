import type { BuildStep, CheckId, CheckState } from '../model/build';
import { LoadingBar } from './LoadingBar';

type Read = Extract<BuildStep, { kind: 'read' }>;
type Found = Extract<BuildStep, { kind: 'found' }>;
type Point = 'description' | 'fact' | 'plan' | 'forecast';
interface Seen { state: CheckState; detail?: string }

const POINT_LABEL: Record<Point, string> = {
  description: "Description isn't empty",
  fact: 'Critical number has a fact',
  plan: 'Critical number has a plan',
  forecast: 'Forecast available',
};
const CONTEXT_POINTS: Point[] = ['description', 'fact', 'plan', 'forecast'];
const STATE_TEXT: Record<CheckState, string> = { pending: 'pending', running: 'in progress', done: 'done', missing: 'not set', failed: 'failed' };

interface Row { id: CheckId; label: string; required: boolean }
const PROJECT_ROWS: Row[] = [
  { id: 'project.description', label: "Project description isn't empty", required: true },
  { id: 'project.fact', label: POINT_LABEL.fact, required: true },
  { id: 'project.plan', label: POINT_LABEL.plan, required: false },
  { id: 'project.forecast', label: POINT_LABEL.forecast, required: false },
  { id: 'marts', label: 'Data Marts read', required: true },
  { id: 'ai', label: 'AI read the descriptions', required: true },
  { id: 'classes', label: 'Classes found', required: true },
];

function Item({ row, seen, text }: { row: Row; seen: Seen | undefined; text?: string }) {
  const state = seen?.state ?? 'pending';
  const bad = state === 'failed' || (state === 'missing' && row.required);
  const notSet = state === 'missing' && !row.required;
  return (
    <li className="gy-chk" data-state={state} data-bad={bad}>
      <span className="gy-chk-mark" aria-hidden="true">{state === 'done' ? '✓' : bad ? '✗' : notSet ? '–' : ''}</span>
      <span className="gy-chk-label">{text ?? row.label}</span>
      <span className="gy-chk-tag">{row.required ? 'Required' : 'Optional'}</span>
      {notSet && <span className="gy-chk-note" aria-hidden="true">Not set</span>}
      {bad && seen?.detail && <span className="gy-chk-detail">{seen.detail}</span>}
      <span className="gy-sr">, {bad && state === 'missing' ? 'failed' : STATE_TEXT[state]}</span>
    </li>
  );
}

/** The build page: the line on top, the checklist, then what was found. */
/** `embedded` draws it inside a page that already has its main landmark. */
export function BuildProgress({ steps, embedded = false }: { steps: BuildStep[]; embedded?: boolean }) {
  const latest = new Map<Read['what'], Read>();
  const checks = new Map<CheckId, Seen>();
  let contexts: { id: string; name: string }[] | null = null;
  let contextsFailed = false;
  let found: Found | null = null;
  let changed: { id: CheckId; state: CheckState } | null = null;
  for (const s of steps) {
    if (s.kind === 'read') latest.set(s.what, s);
    else if (s.kind === 'contexts') { contexts = s.list; contextsFailed = !!s.failed; }
    else if (s.kind === 'check') {
      checks.set(s.id, { state: s.state, detail: s.detail });
      if (s.state !== 'pending') changed = { id: s.id, state: s.state };
    } else found = s;
  }
  const marts = latest.get('marts');
  // the AI call has no count, so the bar slides while it runs; until it has run, reading the marts fills only the first half,
  // since the host bar never moves back and would otherwise sit full through the whole AI call
  const ai = latest.get('ai');
  const progress = marts && marts.total && ai?.finished !== false ? { done: marts.done, total: ai?.finished ? marts.total : marts.total * 2 } : null;

  const labelOf = (row: Row): string => {
    if (row.id === 'marts') return `Data Marts read: ${marts?.done ?? 0} of ${marts?.total ?? '…'}`;
    if (row.id === 'classes') return found && found.classes.length > 0 ? `Classes found: ${found.classes.length}` : 'Classes found';
    return row.label;
  };
  // announces point changes only, so the Data Mart counter ticks stay quiet
  const nameOf = (id: CheckId): string => {
    const fixed = PROJECT_ROWS.find((r) => r.id === id);
    if (fixed) return fixed.label;
    const dot = id.lastIndexOf('.');
    const cid = id.slice('context:'.length, dot);
    const name = contexts?.find((c) => c.id === cid)?.name ?? cid;
    return `${name}: ${POINT_LABEL[id.slice(dot + 1) as Point]}`;
  };
  const Tag = embedded ? 'div' : 'main';
  return (
    <Tag className="gy-main">
      <LoadingBar progress={progress} />
      <div className="gy-build">
        <section aria-label="Checklist">
          <p className="gy-sr" aria-live="polite">{changed ? `${nameOf(changed.id)}: ${STATE_TEXT[changed.state]}` : ''}</p>
          <h2 className="gy-build-h">Project</h2>
          <ul className="gy-build-list">
            {PROJECT_ROWS.map((r) => <Item key={r.id} row={r} seen={checks.get(r.id)} text={labelOf(r)} />)}
          </ul>
          <h2 className="gy-build-h">Contexts</h2>
          {contextsFailed && <p className="gy-muted">Contexts couldn't be read</p>}
          {!contextsFailed && contexts && contexts.length === 0 && <p className="gy-muted">No contexts</p>}
          {contexts?.map((c) => (
            <div key={c.id} className="gy-chk-group" role="group" aria-label={c.name}>
              <h3 className="gy-build-sub">{c.name}</h3>
              <ul className="gy-build-list">
                {CONTEXT_POINTS.map((p) => {
                  const id = `context:${c.id}.${p}` as CheckId;
                  return <Item key={id} row={{ id, label: POINT_LABEL[p], required: false }} seen={checks.get(id)} />;
                })}
              </ul>
            </div>
          ))}
        </section>
        <section aria-label="Found" aria-live="polite">
          {found && <h2 className="gy-build-h">Found</h2>}
          {found && (
            <ul className="gy-build-list">
              {found.goal && <li>Goal: {found.goal}</li>}
              {found.classes.length > 0 && <li>Classes: {found.classes.length} ({found.classes.slice(0, 3).join(', ')}{found.classes.length > 3 ? ', …' : ''})</li>}
              {found.classes.length > 0 && <li>Metrics: {found.metrics}</li>}
            </ul>
          )}
        </section>
      </div>
    </Tag>
  );
}
