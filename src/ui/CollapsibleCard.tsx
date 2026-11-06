import { ChevronDown, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';

/**
 * Mirrors OWOX's CollapsibleCard (the plugin can't import it): icon and title left, status and chevron right, content folds.
 * `section` is OWOX's muted card; `block` is its white `dm-card-block`, bordered, for cards inside a section.
 * The whole header toggles, as in OWOX; the chevron is the keyboard's button.
 * `collapsed` seeds the state and re-applies whenever it changes, so results can fold or open a card the user may still toggle;
 * `attention` opens it when it turns true, even if the user folded it.
 */
export function CollapsibleCard({ title, icon: Icon, status, variant = 'block', collapsed = false, attention = false, label, children }: {
  title: ReactNode; icon?: LucideIcon; status?: ReactNode; variant?: 'section' | 'block'; collapsed?: boolean; attention?: boolean; label?: string; children: ReactNode;
}) {
  const [folded, setFolded] = useState(collapsed);
  const bodyId = useId();
  useEffect(() => { setFolded(collapsed); }, [collapsed]);
  useEffect(() => { if (attention) setFolded(false); }, [attention]);
  const toggle = () => setFolded((f) => !f);
  return (
    <div className="dm-collapsible" data-variant={variant} role="group" aria-label={label}>
      <div className="dm-collapsible-header" onClick={toggle}>
        <span className="dm-collapsible-title">
          {Icon && <span className="dm-collapsible-icon" aria-hidden="true"><Icon size={18} /></span>}
          {title}
        </span>
        <span className="dm-collapsible-actions">
          {status}
          <button type="button" className="dm-collapsible-toggle" aria-expanded={!folded} aria-controls={bodyId} aria-label={label ?? 'section'} onClick={(e) => { e.stopPropagation(); toggle(); }}>
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
