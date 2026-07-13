import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listMarts, getMartFields } from '../lib/api';
import { generate, probeCardinality } from '../lib/generate';
import { saveDashboard } from '../lib/dashboards';
import type { MartRef } from '../lib/types';

const isDateField = (type: string) => /^(DATE|DATETIME|TIMESTAMP)$/i.test(type);

/**
 * Choose a mart, then: getMartFields -> probeCardinality (dimensions only) -> generate ->
 * saveDashboard -> navigate to /d/:id. Every step is a real network call, so this dialog has
 * three distinct "can't proceed" states it must explain rather than dead-end on: the mart list
 * failing to load, the mart list loading empty, and the generate/save pipeline itself failing.
 */
export function CreateDashboardDialog({ onClose }: { onClose: () => void }) {
  const [marts, setMarts] = useState<MartRef[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  const navigate = useNavigate();

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
    setCreateFailed(false);
    try {
      const fields = await getMartFields(mart.id);
      const dims = fields.filter(f => f.role === 'dimension' && !isDateField(f.type));
      const cardinality = await probeCardinality(mart.id, dims);
      const saved = await saveDashboard(generate(mart.id, mart.title, fields, cardinality));
      navigate(`/d/${saved.id}`);
      onClose();
    } catch {
      // Leave the dialog open on failure — closing silently here would be a dead end with no
      // way back to try a different mart or retry.
      setCreateFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/40" role="dialog" aria-label="Choose a data mart">
      <div className="dm-card w-[28rem] p-4">
        <h2 className="mb-3 text-base font-medium">Choose a data mart</h2>

        {busy && <p className="text-sm">Analysing the data mart…</p>}

        {!busy && createFailed && (
          <p className="mb-3 text-sm text-red-600">Couldn&rsquo;t create the dashboard. Try again.</p>
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
          <ul className="max-h-80 overflow-auto">
            {marts.map(m => (
              <li key={m.id}>
                <button className="w-full p-2 text-left text-sm hover:bg-black/5" onClick={() => void create(m)}>
                  {m.title}
                </button>
              </li>
            ))}
          </ul>
        )}

        <button className="mt-3 text-sm" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
