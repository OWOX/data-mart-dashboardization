import { useEffect, useLayoutEffect, useRef } from 'react';

export interface IssueRow { classTitle: string; metricName: string | null; text: string }

/** What the header icon opens: broken references and the out-of-date notice, with a way into the Ontology tab. */
export interface Notices { issues: IssueRow[]; outdated: boolean; onReview: () => void }

export const noticeCount = (n: Notices): number => n.issues.length + (n.outdated ? 1 : 0);

export function IssuesLayer({ notices, layerRef, triggerRef, onClose }: {
  notices: Notices; layerRef: React.RefObject<HTMLDivElement | null>; triggerRef: React.RefObject<HTMLButtonElement | null>; onClose: () => void;
}) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!layerRef.current?.contains(t) && !triggerRef.current?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { layerRef.current?.focus(); }, [layerRef]);
  // opens under the icon, shifted left only as far as it takes to stay inside the header
  useLayoutEffect(() => {
    const el = layerRef.current;
    const box = el?.offsetParent as HTMLElement | null;
    const btn = triggerRef.current;
    if (!el || !box || !btn) return;
    const place = () => {
      el.style.left = '';
      if (window.matchMedia?.('(max-width: 640px)').matches) return;
      const at = btn.getBoundingClientRect().left - box.getBoundingClientRect().left;
      el.style.left = `${Math.max(0, Math.min(at, box.clientWidth - el.offsetWidth))}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [layerRef, triggerRef]);

  return (
    <div ref={layerRef} className="gy-issues" tabIndex={-1} role="dialog" aria-label="Issues">
      {notices.issues.length > 0 && (
        <section className="gy-issues-group" aria-labelledby="gy-issues-refs">
          <h2 id="gy-issues-refs" className="gy-issues-heading">Broken references</h2>
          <ul className="gy-issues-list">
            {notices.issues.map((i, k) => (
              <li key={k}>
                <span className="gy-issues-where">{i.classTitle}{i.metricName ? ` · ${i.metricName}` : ''}</span>
                <span>{i.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {notices.outdated && (
        <section className="gy-issues-group" aria-labelledby="gy-issues-old">
          <h2 id="gy-issues-old" className="gy-issues-heading">Model out of date</h2>
          <p className="gy-issues-text">The descriptions changed since this model was built.</p>
          <button type="button" className="gy-btn" onClick={notices.onReview}>Rebuild to see proposed changes</button>
        </section>
      )}
      <div className="gy-issues-foot">
        <button type="button" className="gy-link" onClick={notices.onReview}>Review in Metrics</button>
      </div>
    </div>
  );
}
