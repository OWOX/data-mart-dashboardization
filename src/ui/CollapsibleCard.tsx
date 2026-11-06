import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';

/** Mirrors OWOX's CollapsibleCard (the plugin can't import it): title left, status and chevron right, content folds. `collapsed` seeds the state and re-applies whenever it changes, so results can fold or open a card the user may still toggle. */
export function CollapsibleCard({ title, status, collapsed = false, label, children }: { title: ReactNode; status?: ReactNode; collapsed?: boolean; label?: string; children: ReactNode }) {
  const [folded, setFolded] = useState(collapsed);
  const bodyId = useId();
  useEffect(() => { setFolded(collapsed); }, [collapsed]);
  return (
    <div className="dm-collapsible" role="group" aria-label={label}>
      <div className="dm-collapsible-header">
        <span className="dm-collapsible-title">{title}</span>
        <span className="dm-collapsible-actions">
          {status}
          <button type="button" className="dm-collapsible-toggle" aria-expanded={!folded} aria-controls={bodyId} aria-label={`${folded ? 'Expand' : 'Collapse'} ${label ?? 'section'}`} onClick={() => setFolded((f) => !f)}>
            <ChevronDown size={16} data-folded={folded} aria-hidden="true" />
          </button>
        </span>
      </div>
      <div className="dm-collapsible-grid" data-folded={folded}>
        <div id={bodyId} className="dm-collapsible-clip" aria-hidden={folded} inert={folded}>
          <div className="dm-collapsible-content">{children}</div>
        </div>
      </div>
    </div>
  );
}
