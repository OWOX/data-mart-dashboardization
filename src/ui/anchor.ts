import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/**
 * A fixed position just below `anchor` while `open`, so a popup escapes the table's scroll box instead of being
 * clipped by it. It follows the anchor on any scroll or resize.
 */
export function useBelow(anchor: RefObject<HTMLElement | null>, open: boolean): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (r) setStyle({ position: 'fixed', top: r.bottom, left: r.left, minWidth: r.width });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [anchor, open]);
  return open ? style : undefined;
}
