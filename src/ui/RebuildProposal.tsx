import { useState } from 'react';
import type { Change } from '../model/diff';

const FIELD_LABELS: Record<Extract<Change, { kind: 'metric_changed' }>['field'], string> = {
  measure: 'fact', dateField: 'date field', plan: 'plan', kind: 'kind', format: 'format',
};

function describe(c: Change, nameOf: (id: string) => string): { what: string; detail: string | null } {
  switch (c.kind) {
    case 'class_added': return { what: `Add class ${c.title}`, detail: null };
    case 'class_removed': return { what: `Remove class ${c.title}`, detail: null };
    case 'metric_added': return { what: `Add metric ${c.alias}`, detail: null };
    case 'metric_removed': return { what: `Remove metric ${c.alias}`, detail: null };
    case 'metric_changed': return { what: `${nameOf(c.metricId)}: ${FIELD_LABELS[c.field]}`, detail: `${c.before} → ${c.after}` };
  }
}

/** Indexes of the changes per Data Mart, in order of first mention; a class row leads its group. */
function groups(changes: Change[]): [string, number[]][] {
  const by = new Map<string, number[]>();
  changes.forEach((c, i) => { const g = by.get(c.classId) ?? []; g.push(i); by.set(c.classId, g); });
  const isClass = (i: number) => changes[i]!.kind === 'class_added' || changes[i]!.kind === 'class_removed';
  return [...by].map(([id, rows]) => [id, [...rows.filter(isClass), ...rows.filter((i) => !isClass(i))]]);
}

/** What a rebuild would change, grouped by Data Mart, one row per change, all picked. Nothing is saved until Apply selected. */
export function RebuildProposal({ changes, titleOf, nameOf, busy, error, needs, relinks = false, onApply, onDiscard, onClose }: {
  changes: Change[];
  titleOf: (classId: string) => string;
  nameOf: (metricId: string) => string;
  /** The change a row cannot go ahead without, if any. */
  needs?: (c: Change) => Change | null;
  /** The connections between cards differ too: Apply redraws them, even with nothing picked. */
  relinks?: boolean;
  busy: boolean;
  error: string | null;
  onApply: (picked: Change[]) => void;
  onDiscard: () => void;
  /** With no changes: closes the proposal. */
  onClose: () => void;
}) {
  const [off, setOff] = useState<ReadonlySet<number>>(new Set());
  const dep = (i: number): number => { const d = needs?.(changes[i]!); return d ? changes.indexOf(d) : -1; };
  const blocked = (i: number): boolean => dep(i) >= 0 && off.has(dep(i));
  const picked = changes.filter((_, i) => !off.has(i) && !blocked(i));
  const toggle = (i: number, on: boolean) => setOff((p) => {
    const n = new Set(p);
    if (on) n.delete(i);
    else { n.add(i); changes.forEach((_, j) => { if (dep(j) === i) n.add(j); }); }
    return n;
  });

  if (changes.length === 0) {
    return (
      <section className="dm-card gy-onto-intro" aria-label="Rebuild proposal">
        <p className="gy-onto-note">The model already matches the descriptions.</p>
        {error && <p role="alert" className="gy-form-error">{error}</p>}
        <div className="gy-form-actions"><button type="button" className="gy-btn" onClick={onClose} disabled={busy}>Close</button></div>
      </section>
    );
  }
  return (
    <section className="dm-card gy-onto-class" aria-label="Rebuild proposal">
      <p className="gy-onto-note">The descriptions suggest these changes. Nothing is saved until you apply them.</p>
      {groups(changes).map(([classId, rows]) => (
        <div key={classId} className="gy-proposal-group">
          <h4 className="gy-proposal-title">{titleOf(classId)}</h4>
          <ul className="gy-proposal">
            {rows.map((i) => {
              const { what, detail } = describe(changes[i]!, nameOf);
              return (
                <li key={i} className="gy-proposal-row">
                  <label className="gy-check">
                    <input type="checkbox" checked={!off.has(i) && !blocked(i)} disabled={blocked(i)} onChange={(e) => toggle(i, e.target.checked)} />
                    <span>{what}</span>
                  </label>
                  {detail && <span>{detail}</span>}
                  {blocked(i) && <span className="dm-muted gy-onto-contexts">Needs the new goal class</span>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {relinks && <p className="dm-muted gy-onto-note">The connections between cards changed too. Apply redraws them, even with nothing selected.</p>}
      {error && <p role="alert" className="gy-form-error">{error}</p>}
      <div className="gy-form-actions">
        <button type="button" className="gy-btn gy-btn-primary" onClick={() => onApply(picked)} disabled={busy || (picked.length === 0 && !relinks)}>Apply selected</button>
        <button type="button" className="gy-btn" onClick={onDiscard} disabled={busy}>Discard</button>
      </div>
    </section>
  );
}
