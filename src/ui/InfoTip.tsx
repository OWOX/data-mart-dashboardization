import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { owoxPath } from '../lib/links';
import { useBelow } from './anchor';
import { HOSTS, LINGER_MS } from './Card';
import { MarkdownText } from './MarkdownText';

/** Where a link to an OWOX page in a tip goes, so it opens in the same tab. */
export const OpenPath = createContext<((path: string) => void) | undefined>(undefined);

/** An (i) button that shows a live description as Markdown on hover, focus and click. The text stays mounted so it is read once; it lingers after the pointer leaves so a link in it can be clicked. */
export function InfoTip({ name, text }: { name: string; text: string }) {
  const id = useId();
  const onOpen = useContext(OpenPath);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const open = hover || focus || pinned;
  const anchor = useRef<HTMLSpanElement>(null);
  const style = useBelow(anchor, open);
  return (
    <span ref={anchor} className="gy-tip" onMouseEnter={() => { clearTimeout(timer.current); setHover(true); }} onMouseLeave={() => { clearTimeout(timer.current); timer.current = setTimeout(() => setHover(false), LINGER_MS); }}
      onFocus={() => setFocus(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setFocus(false); setPinned(false); } }}>
      <button
        type="button" className="gy-tip-btn" aria-label={`About ${name}`} aria-describedby={id}
        onClick={() => setPinned((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setHover(false); setFocus(false); setPinned(false); } }}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      <span
        role="tooltip" id={id} hidden={!open} className="gy-tip-pop" style={style}
        onClick={(e) => {
          const a = (e.target as Element).closest('a');
          const path = a && onOpen ? owoxPath(a.getAttribute('href') ?? '', HOSTS) : null;
          if (path) { e.preventDefault(); setHover(false); setFocus(false); setPinned(false); onOpen!(path); }
        }}
      >
        <div className="gy-md"><MarkdownText text={text} /></div>
      </span>
    </span>
  );
}
