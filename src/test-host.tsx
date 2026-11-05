import { useCallback, useState, type ReactNode } from 'react';
import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import { HostLoadingContext, type HostLoading } from './ui/LoadingBar';

export * from '@testing-library/react';

let seq = 0;

/** The host's top bar, faked: shown while any loading runs; aria-valuenow is the average percent once every loading has one. */
export function FakeHost({ children }: { children?: ReactNode }) {
  const [tasks, setTasks] = useState<ReadonlyMap<number, number | null>>(new Map());
  const start = useCallback((): HostLoading => {
    const id = ++seq;
    setTasks((m) => new Map(m).set(id, null));
    return {
      setProgress: (f) => setTasks((m) => (m.has(id) ? new Map(m).set(id, f) : m)),
      stop: () => setTasks((m) => { const n = new Map(m); n.delete(id); return n; }),
    };
  }, []);
  const fractions = [...tasks.values()];
  const known = fractions.length > 0 && fractions.every((f) => f !== null);
  const pct = known ? Math.round((fractions.reduce<number>((a, f) => a + f!, 0) / fractions.length) * 100) : undefined;
  return (
    <HostLoadingContext value={start}>
      {children}
      {tasks.size > 0 && <div role="progressbar" aria-label="Loading data" data-determinate={known} aria-valuenow={pct} />}
    </HostLoadingContext>
  );
}

/** Testing Library's render inside FakeHost. */
export const render = (ui: ReactNode, options?: RenderOptions) => rtlRender(ui, { wrapper: FakeHost, ...options });
