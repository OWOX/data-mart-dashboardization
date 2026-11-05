import { createContext, useContext, useEffect, useRef } from 'react';

export interface LoadingProgress { done: number; total: number }

/** One piece of work on the host's top loading bar (ctx.ui.startLoading). */
export interface HostLoading { setProgress(fraction: number): void; stop(): void }
export type StartLoading = () => HostLoading;

/** ctx.ui.startLoading; null outside the host (tests), where no bar shows. */
export const HostLoadingContext = createContext<StartLoading | null>(null);

/** Shows the host's top loading bar while mounted: filled to done / total once the total is known, sliding until then. Draws nothing itself. */
export function LoadingBar({ progress }: { progress?: LoadingProgress | null }) {
  const start = useContext(HostLoadingContext);
  const handle = useRef<HostLoading | null>(null);
  const hasFraction = useRef(false);
  useEffect(() => {
    if (!start) return;
    handle.current = start();
    hasFraction.current = false;
    return () => {
      const h = handle.current;
      handle.current = null;
      // stopped a tick later: a bar mounting in the next view takes over without the host bar finishing in between
      if (h) setTimeout(() => h.stop(), 0);
    };
  }, [start]);
  const fraction = progress && progress.total > 0 ? progress.done / progress.total : null;
  useEffect(() => {
    const h = handle.current;
    if (!start || !h) return;
    if (fraction !== null) { h.setProgress(fraction); hasFraction.current = true; return; }
    if (!hasFraction.current) return;
    // a loading can't drop its amount, so a lost total takes a new one; it starts first so the bar never empties
    handle.current = start();
    hasFraction.current = false;
    h.stop();
  }, [start, fraction]);
  return null;
}
