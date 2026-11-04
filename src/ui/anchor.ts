import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/**
 * A fixed position just below `anchor` (above it near the viewport's bottom) while `open`, so a popup escapes the table's scroll box instead of being
 * clipped by it. It follows the anchor on any scroll or resize.
 */
export function useBelow(anchor: RefObject<HTMLElement | null>, open: boolean): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      // near the bottom of the viewport it opens upward; either way it fits the space it has
      const below = window.innerHeight - r.bottom;
      const up = below < 240 && r.top > below;
      const room = `min(18rem, ${Math.max((up ? r.top : below) - 8, 0)}px)`;
      setStyle(up
        ? { position: 'fixed', top: 'auto', bottom: window.innerHeight - r.top, marginTop: 0, marginBottom: '0.25rem', left: r.left, minWidth: r.width, maxHeight: room, overflowY: 'auto' }
        : { position: 'fixed', top: r.bottom, bottom: 'auto', left: r.left, minWidth: r.width, maxHeight: room, overflowY: 'auto' });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [anchor, open]);
  return open ? style : undefined;
}
