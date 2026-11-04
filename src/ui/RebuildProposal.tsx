import { useState } from 'react';
import type { Change } from '../model/diff';

const FIELD_LABELS: Record<Extract<Change, { kind: 'metric_changed' }>['field'], string> = {
  alias: 'name', role: 'role', measure: 'fact', dateField: 'date field', plan: 'plan', kind: 'kind',
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

/** What a rebuild would change, one row per change, all picked. Nothing is saved until Apply selected. */
export function RebuildProposal({ changes, titleOf, nameOf, busy, error, onApply, onDiscard }: {
  changes: Change[];
  titleOf: (classId: string) => string;
  nameOf: (metricId: string) => string;
  busy: boolean;
  error: string | null;
  onApply: (picked: Change[]) => void;
  onDiscard: () => void;
}) {
  const [off, setOff] = useState<ReadonlySet<number>>(new Set());
  const picked = changes.filter((_, i) => !off.has(i));
  const toggle = (i: number, on: boolean) => setOff((p) => { const n = new Set(p); if (on) n.delete(i); else n.add(i); return n; });

  if (changes.length === 0) {
    return (
      <section className="dm-card gy-onto-intro" aria-label="Rebuild proposal">
        <p className="gy-onto-note">The model already matches the descriptions.</p>
        <div className="gy-form-actions"><button type="button" className="gy-btn" onClick={onDiscard}>Close</button></div>
      </section>
    );
  }
  return (
    <section className="dm-card gy-onto-class" aria-label="Rebuild proposal">
      <p className="gy-onto-note">The descriptions suggest these changes. Nothing is saved until you apply them.</p>
      <ul className="gy-proposal">
        {changes.map((c, i) => {
          const { what, detail } = describe(c, nameOf);
          return (
            <li key={i} className="gy-proposal-row">
              <label className="gy-check">
                <input type="checkbox" checked={!off.has(i)} onChange={(e) => toggle(i, e.target.checked)} />
                <span>{what}</span>
              </label>
              <span className="dm-muted gy-onto-contexts">{titleOf(c.classId)}</span>
              {detail && <span>{detail}</span>}
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="gy-form-error">{error}</p>}
      <div className="gy-form-actions">
        <button type="button" className="gy-btn gy-btn-primary" onClick={() => onApply(picked)} disabled={busy || picked.length === 0}>Apply selected</button>
        <button type="button" className="gy-btn" onClick={onDiscard} disabled={busy}>Discard</button>
      </div>
    </section>
  );
}
