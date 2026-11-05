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
  const known = !!progress && progress.total > 0;
  const handle = useRef<HostLoading | null>(null);
  // the host bar can't go back to sliding, so a total that is lost again starts a fresh loading
  useEffect(() => {
    if (!start) return;
    const h = start();
    handle.current = h;
    return () => { h.stop(); handle.current = null; };
  }, [start, known]);
  const fraction = known ? progress.done / progress.total : null;
  useEffect(() => { if (fraction !== null) handle.current?.setProgress(fraction); }, [fraction, known]);
  return null;
}
