import type { BuildStep } from '../model/build';
import { LoadingLine } from './LoadingLine';

type Read = Extract<BuildStep, { kind: 'read' }>;
type Found = Extract<BuildStep, { kind: 'found' }>;

const ORDER: Read['what'][] = ['project', 'contexts', 'marts', 'ai'];

function label(r: Read): string {
  switch (r.what) {
    case 'project': return 'Project description';
    case 'contexts': return `Contexts: ${r.done}`;
    case 'marts': return `Data Marts: ${r.done} of ${r.total ?? '…'}`;
    case 'ai': return 'AI reading descriptions…';
  }
}

/** The build page: the line on top, what is being read on the left, what was found on the right. */
export function BuildProgress({ steps }: { steps: BuildStep[] }) {
  const latest = new Map<Read['what'], Read>();
  let found: Found | null = null;
  for (const s of steps) {
    if (s.kind === 'read') latest.set(s.what, s);
    else found = s;
  }
  const marts = latest.get('marts');
  const progress = marts && marts.total ? { done: marts.done, total: marts.total } : null;
  const reads = ORDER.flatMap((w) => { const r = latest.get(w); return r ? [r] : []; });
  return (
    <main className="gy-main">
      <LoadingLine progress={progress} />
      <div className="gy-build">
        <section aria-label="Reading">
          <h2 className="gy-build-h">Reading</h2>
          <ul className="gy-build-list">
            {reads.map((r) => (
              <li key={r.what} data-done={r.finished}>
                <span className="gy-build-tick" aria-hidden="true">{r.finished ? '✓' : ''}</span>
                {label(r)}
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Found">
          <h2 className="gy-build-h">Found</h2>
          {found && (
            <ul className="gy-build-list">
              {found.goal && <li>Goal: {found.goal}</li>}
              <li>Classes: {found.classes.length}{found.classes.length > 0 && ` (${found.classes.slice(0, 3).join(', ')}${found.classes.length > 3 ? ', …' : ''})`}</li>
              <li>Metrics: {found.metrics}</li>
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
