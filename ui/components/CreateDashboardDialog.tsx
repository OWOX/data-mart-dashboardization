import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listMarts, getMartFields } from '../lib/api';
import { generate, probeCardinality } from '../lib/generate';
import { saveDashboard } from '../lib/dashboards';
import { describeError } from '../lib/errors';
import type { MartRef } from '../lib/types';

const isDateField = (type: string) => /^(DATE|DATETIME|TIMESTAMP)$/i.test(type);

/** Everything the panel's own Tab-trap and initial-focus logic below treats as a stop. */
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Choose a mart, then: getMartFields -> probeCardinality (dimensions only) -> generate ->
 * saveDashboard -> navigate to /d/:id. Every step is a real network call, so this dialog has
 * three distinct "can't proceed" states it must explain rather than dead-end on: the mart list
 * failing to load, the mart list loading empty, and the generate/save pipeline itself failing.
 */
export function CreateDashboardDialog({ onClose }: { onClose: () => void }) {
  const [marts, setMarts] = useState<MartRef[] | null>(null);
  const [query, setQuery] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const navigate = useNavigate();

  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  // `onClose` is read from a ref inside the keydown listener below so that listener doesn't need
  // to be torn down and re-attached on every render just because the caller passed a new closure.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // DashboardList mounts a fresh `<CreateDashboardDialog>` per open (`{creating && <CreateDashboardDialog
  // .../>}`) and unmounts it to close, so mount/unmount here IS open/close. On mount: remember
  // whatever had focus (the "New dashboard" trigger) and move focus into the panel. On unmount:
  // give focus back to that trigger — without this the keyboard/screen-reader user is dropped
  // onto <body> when the dialog closes, with no indication of where they are.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = panel ? [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)] : [];
    (focusables[0] ?? panel)?.focus();
    return () => {
      trigger?.focus();
    };
  }, []);

  // Escape-to-close and a Tab focus trap. Listens on `document` (not the panel) so Escape/Tab work
  // regardless of which descendant currently has focus. No dependency (e.g. Radix) is used here —
  // this is the minimal dependency-free implementation of both behaviors.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const loadMarts = () => {
    setLoadFailed(false);
    setMarts(null);
    void listMarts()
      .then(setMarts)
      .catch(() => setLoadFailed(true));
  };

  useEffect(loadMarts, []);

  async function create(mart: MartRef) {
    setBusy(true);
    setCreateError(null);
    // Which host call is in flight. Only two of these steps can throw — `probeCardinality` catches
    // every probe itself and `generate` is pure — and they fail for unrelated reasons (reading a
    // Data Mart's schema vs. writing to the bound `dashboards` collection), so the message has to
    // say which one, or a failure is indistinguishable from the other on screen.
    let step = 'reading the Data Mart schema';
    try {
      const fields = await getMartFields(mart.id);
      const dims = fields.filter(f => f.role === 'dimension' && !isDateField(f.type));
      const cardinality = await probeCardinality(mart.id, dims);
      step = 'saving the dashboard';
      const saved = await saveDashboard(generate(mart.id, mart.title, fields, cardinality));
      navigate(`/d/${saved.id}`);
      onClose();
    } catch (error) {
      // Leave the dialog open on failure — closing silently here would be a dead end with no way
      // back to try a different mart or retry.
      console.error(`[dashboards] create failed for mart ${mart.id} "${mart.title}" while ${step}`, error);
      setCreateError(`${step}: ${describeError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const matches = (marts ?? []).filter(m => m.title.toLowerCase().includes(needle));

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/40" role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <div ref={panelRef} className="dm-card w-[28rem] p-4" tabIndex={-1}>
        <h2 id={headingId} className="mb-3 text-base font-medium">Choose a data mart</h2>

        {busy && <p className="text-sm">Analysing the data mart…</p>}

        {!busy && createError !== null && (
          <p className="mb-3 text-sm text-red-600">
            Couldn&rsquo;t create the dashboard: {createError}
          </p>
        )}

        {!busy && marts === null && !loadFailed && <p className="text-sm">Loading data marts…</p>}

        {!busy && loadFailed && (
          <div className="text-sm">
            <p>Couldn&rsquo;t load data marts. Check your connection and try again.</p>
            <button className="mt-2 underline" onClick={loadMarts}>Try again</button>
          </div>
        )}

        {!busy && !loadFailed && marts !== null && marts.length === 0 && (
          <p className="text-sm">
            No data marts available. Publish a data mart and mark it available for reporting to
            create a dashboard from it.
          </p>
        )}

        {!busy && !loadFailed && marts !== null && marts.length > 0 && (
          <>
            {/* First focusable in the panel, so the initial-focus effect above lands here and the
                list is filterable by typing straight after opening the dialog. */}
            <input
              type="search"
              className="mb-2 w-full rounded border p-2 text-sm"
              placeholder="Search data marts"
              aria-label="Search data marts"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {matches.length === 0 ? (
              <p className="p-2 text-sm">No data marts match &ldquo;{query}&rdquo;.</p>
            ) : (
              <ul className="max-h-80 overflow-auto">
                {matches.map(m => (
                  <li key={m.id}>
                    <button className="w-full p-2 text-left text-sm hover:bg-black/5" onClick={() => void create(m)}>
                      {m.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <button className="mt-3 text-sm" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
