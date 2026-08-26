import { describeError } from './errors';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Config edits apply (and refetch) after this idle delay, so dragging a slider isn't N queries. */
export const APPLY_DEBOUNCE_MS = 1000;

export type LayerStatus = 'idle' | 'loading' | 'stale' | 'ready';

/**
 * One component's data lifecycle. Refetch is keyed on `configVersion` and debounced. While a
 * refetch is in flight the previous `data` is retained, so the component shows its last-good
 * render under a progress indicator instead of flashing empty. Errors keep the last-good data too
 * and surface as `stale` with a `refresh()` affordance.
 *
 * Race safety: each effect run owns a local `cancelled` flag. If `configVersion`/`enabled`/
 * `refresh()` fires again before this run's fetch resolves, React's cleanup flips that flag
 * before the next run starts, so a slow, now-superseded response can never clobber fresher state
 * — regardless of network resolution order. The pending debounce timer is cleared the same way,
 * so a burst of rapid changes (e.g. dragging a date filter) fires at most one request per idle
 * gap, never one per keystroke.
 *
 * `refresh()` is the odd one out on purpose: it bypasses the debounce and fetches immediately.
 * The debounce exists to coalesce rapid config/filter edits (e.g. dragging a slider) into one
 * request; a user clicking "refresh" wants that request to fire right now, not after waiting out
 * an idle gap. It still goes through the same effect (via `nonce`) so it gets the same
 * cancellation guard as any other run.
 *
 * `T` is left opaque on purpose (no post-processing here): when `T` is `QueryResult`, its
 * `truncated` flag rides through in `data` untouched for the caller to surface.
 */
export function useLayerData<T>(
  configVersion: number,
  enabled: boolean,
  fetcher: () => Promise<T>,
  debounceMs: number = APPLY_DEBOUNCE_MS
): { data: T | null; status: LayerStatus; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<LayerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Keep the latest fetcher without making it a re-run trigger (it's a new closure every render).
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Set by refresh() just before bumping `nonce`, consumed (and cleared) by the very next effect
  // run so that run fetches immediately instead of waiting out the debounce.
  const immediateRef = useRef(false);

  const refresh = useCallback(() => {
    immediateRef.current = true;
    setNonce(n => n + 1);
  }, []);

  useEffect(() => {
    const isImmediate = immediateRef.current;
    immediateRef.current = false;

    if (!enabled) {
      setStatus('stale');
      return;
    }

    let cancelled = false;
    setStatus('loading');

    const runFetch = () => {
      fetcherRef.current()
        .then(result => {
          if (cancelled) return;
          setData(result);
          setError(null);
          setStatus('ready');
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(describeError(err));
          setStatus('stale'); // last-good `data` is deliberately retained
        });
    };

    const timer = isImmediate ? undefined : setTimeout(runFetch, debounceMs);
    if (isImmediate) runFetch();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [configVersion, enabled, debounceMs, nonce]);

  return { data, status, error, refresh };
}
